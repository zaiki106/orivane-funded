import {cloudData} from '../lib/orivane-data.mjs';
export default async function handler(req,res){
 const name=req.query?.name;
 if(typeof name!=='string'||!['kraken','nasdaq','news'].includes(name)){res.statusCode=404;res.end('Not found');return;}
 const reply=await cloudData(new Request('https://data.internal/cloud/'+name,{method:req.method}));
 res.statusCode=reply.status;
 reply.headers.forEach((v,k)=>res.setHeader(k,v));
 res.end(Buffer.from(await reply.arrayBuffer()));
}
