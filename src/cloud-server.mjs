import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createApp} from './server.mjs';
import {ModelWorkerPool} from './model-worker.mjs';

// Separate authenticated edge: the original terminal stays on loopback.
export async function createCloudApp({origin,password,terminalOptions={}}={}){
  const publicUrl=new URL(origin);
  if(publicUrl.protocol!=='https:'||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||publicUrl.username||publicUrl.password)throw Error('Origine HTTPS invalide');
  if(typeof password!=='string'||password.length<24||password.includes(':'))throw Error('Mot de passe cloud requis (24 caractères minimum)');
  const expected=createHash('sha256').update('orivane:'+password).digest();
  const app=createApp({...terminalOptions,port:0});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const upstreamPort=app.server.address().port;
  const server=http.createServer((req,res)=>{
    const reply=(status,message,headers={})=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(message);};
    if(req.headers.host!==publicUrl.host||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==publicUrl.origin))return reply(403,'Origine refusée');
    if(req.method==='GET'&&req.url==='/healthz')return reply(200,'ok');
    const auth=req.headers.authorization??'';
    const raw=/^Basic [A-Za-z0-9+/]+={0,2}$/.test(auth)?Buffer.from(auth.slice(6),'base64').toString('utf8'):'';
    if(!timingSafeEqual(createHash('sha256').update(raw).digest(),expected))return reply(401,'Connexion privée Orivane',{'WWW-Authenticate':'Basic realm="Orivane", charset="UTF-8"'});
    const headers={...req.headers,host:'127.0.0.1:'+upstreamPort};delete headers.authorization;
    if(headers.origin)headers.origin='http://127.0.0.1:'+upstreamPort;
    const proxy=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},upstream=>{
      res.writeHead(upstream.statusCode,{...upstream.headers,'Cache-Control':'no-store'});upstream.pipe(res);
      res.on('close',()=>upstream.destroy());
    });
    proxy.on('error',()=>{if(!res.headersSent)reply(502,'Serveur en reconnexion');else res.destroy();});
    req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());req.pipe(proxy);
  });
  server.requestTimeout=30000;
  return {server,terminal:app,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();}};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT??10000);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port invalide');
  const app=await createCloudApp({origin:process.env.RENDER_EXTERNAL_URL??process.env.ORIVANE_PUBLIC_ORIGIN,password:process.env.ORIVANE_ACCESS_PASSWORD,
    terminalOptions:{dbPath:process.env.ORIVANE_DB_PATH??path.resolve('runtime/cloud/funded.sqlite'),modelPoolFactory:options=>new ModelWorkerPool({...options,concurrency:1})}});
  app.server.listen(port,'0.0.0.0',()=>{console.log('Orivane cloud privé : serveur démarré');app.terminal.refresh().catch(()=>{});});
  for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{await app.close();process.exit(0);});
}
