import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {cloudData} from './lib/orivane-data.mjs';

const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
export function createMobileServer({cloudHandler=cloudData}={}){
 return http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  try{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method denied');return;}
   const url=new URL(req.url,'http://mobile.internal');
   if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':mime['.json'],'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok',version:'intelligence-mobile3'}));return;}
   if(url.pathname.startsWith('/cloud/')){
    const response=await cloudHandler(new Request('https://mobile.internal'+url.pathname,{method:req.method}));
    res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const pathname=decodeURIComponent(url.pathname);
   if(pathname.includes('\\')||pathname.includes('\0')){res.writeHead(400);res.end('Invalid path');return;}
   const target=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
   if(!target.startsWith(publicRoot)){res.writeHead(404);res.end('Not found');return;}
   let bytes;try{bytes=await readFile(target);}catch(error){if(['ENOENT','EISDIR','ENOTDIR'].includes(error.code)){res.writeHead(404);res.end('Not found');return;}throw error;}
   res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'application/octet-stream','Cache-Control':pathname.startsWith('/terminal-ui/assets/')?'public, max-age=31536000, immutable':'no-store'});
   res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){res.writeHead(error instanceof URIError?400:500,{'Cache-Control':'no-store'});res.end('Request failed');}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const port=Number(process.env.PORT??4330);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
 const server=createMobileServer();server.listen(port,'0.0.0.0',()=>console.log('Orivane mobile listening on '+port));
 for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>server.close(()=>process.exit(0)));
}
