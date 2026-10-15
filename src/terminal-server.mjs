import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {intelligenceCatalog,loadEvidenceAudit} from './intelligence-cli.mjs';

const candidates=[new URL('../mobile-cloud/',import.meta.url),new URL('../../orivane-mobile-cloud/',import.meta.url)];
let appRoot;
for(const url of candidates){try{await fs.access(new URL('public/index.html',url));appRoot=fileURLToPath(url);break;}catch{}}
if(!appRoot)throw Error('Le dossier mobile-cloud/public du nouveau terminal est absent.');
const publicRoot=path.resolve(appRoot,'public');
const {cloudData}=await import(pathToFileURL(path.join(appRoot,'lib/orivane-data.mjs')).href);
const port=Number(process.env.ORIVANE_TERMINAL_PORT??4328);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port terminal invalide.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);res.end();return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({application:'orivane-terminal',version:'wallstreet12'}));return;}
  if(['/research/intelligence/catalog','/research/intelligence/audit'].includes(url.pathname)){
   const origin=req.headers.origin;if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin)){res.writeHead(403);res.end();return;}
   const result=url.pathname.endsWith('/catalog')?intelligenceCatalog():await loadEvidenceAudit();
   res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify(result));return;
  }
  if(url.pathname.startsWith('/cloud/')){
   const reply=await cloudData(new Request('https://data.internal'+url.pathname,{method:req.method==='HEAD'?'GET':'GET'}));
   res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await reply.arrayBuffer()));return;
  }
  const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  if(requested.includes('\0')||requested.includes('\\')){res.writeHead(400);res.end();return;}
  const file=path.resolve(publicRoot,'.'+requested);
  if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}
  const data=await fs.readFile(file);
  res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Orivane — nouveau terminal http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
