import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../orivane-mobile-cloud/public/',import.meta.url)),port=Number(process.env.ORIVANE_UI_PREVIEW_PORT??4336);
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://127.0.0.1:${port}`);if(url.pathname.startsWith('/cloud/')){const upstream=await fetch('https://orivane-funded-mobile.vercel.app'+url.pathname),body=await upstream.text();res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);return;}const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}const body=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]??'text/plain','cache-control':'no-store'});res.end(body);}catch{if(!res.headersSent)res.writeHead(404);res.end();}}).listen(port,'127.0.0.1',()=>console.log(`UI preview http://127.0.0.1:${port}`));
