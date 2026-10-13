// Fixed provider endpoints: no URL forwarding or user data.
// @ts-ignore Browser-compatible original module without filesystem entry points.
import {fetchYahooSnapshot} from "./orivane/provider-import.mjs";
// @ts-ignore Original bounded RSS parser and publisher allowlist.
import {fetchNews} from "./orivane/news.mjs";
const cache=new Map();
const pending=new Map();
export async function cloudData(request){
 if(request.method!=="GET")return new Response("Method denied",{status:405});
 const key=new URL(request.url).pathname;
 if(!["/cloud/kraken","/cloud/nasdaq","/cloud/news"].includes(key))return new Response("Not found",{status:404});
 try{
  const old=cache.get(key),ttl=key==="/cloud/news"?300000:30000;
  let value;
  if(old&&Date.now()-old.at<ttl)value=old.value;
  else {
   let task=pending.get(key);
   if(!task){task=(async()=>{
    if(key==="/cloud/nasdaq")return fetchYahooSnapshot("NDX");
    if(key==="/cloud/news")return fetchNews();
    const options={signal:AbortSignal.timeout(12000)};
    const [a,b]=await Promise.all([fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15",options),fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD",options)]);
    if(!a.ok||!b.ok)throw Error("Kraken unavailable");return {ohlc:await a.json(),ticker:await b.json(),receivedAt:new Date().toISOString()};
   })();pending.set(key,task);}
   try{value=await task;cache.set(key,{value,at:Date.now()});}finally{pending.delete(key);}
  }
  return Response.json(value,{headers:{"Cache-Control":"no-store"}});
 }catch{return Response.json({error:"Fournisseur indisponible; aucune donnée créée"},{status:502});}
}
