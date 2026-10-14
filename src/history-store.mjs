// Only received, closed provider candles are retained. Quotes are never cached.
export function mergeHistory(previous, incoming, limit=5000) {
  const older=previous?.symbol===incoming.symbol&&previous?.source===incoming.source&&previous?.timeframe===incoming.timeframe&&cacheUsable(previous)?previous.bars:[];
  return [...new Map([...(older??[]),...incoming.bars].filter(b=>b.closed!==false).map(b=>[b.time,b])).values()]
    .sort((a,b)=>a.time.localeCompare(b.time)).slice(-limit);
}
export const derivCacheTTL=24*3600000;
const restricted=dataset=>String(dataset?.source??'').startsWith('Deriv');
export function cacheUsable(dataset,now=Date.now()){
  if(!restricted(dataset))return true;
  const requested=Date.parse(dataset.requestedAt??dataset.receivedAt),expires=Date.parse(dataset.expiresAt);
  return Number.isFinite(requested)&&requested<=now+60000&&now<Math.min(requested+derivCacheTTL,Number.isFinite(expires)?expires:Infinity);
}
let opening;
function open(){
  if(!globalThis.indexedDB)return Promise.reject(Error('Historical cache unavailable'));
  return opening??=(new Promise((resolve,reject)=>{
    const request=indexedDB.open('orivane-provider-history-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('markets',{keyPath:'symbol'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  }));
}
export async function readHistory(){
  try {const db=await open();return await new Promise((resolve,reject)=>{const tx=db.transaction('markets','readwrite'),store=tx.objectStore('markets'),r=store.getAll();r.onsuccess=()=>{const allowed=r.result.filter(x=>cacheUsable(x));for(const x of r.result)if(!cacheUsable(x))store.delete(x.symbol);resolve(allowed);};r.onerror=()=>reject(r.error);});}
  catch{return [];}
}
export async function saveHistory(dataset){
  if(!cacheUsable(dataset))return false;
  try {const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('markets','readwrite'),requestedAt=restricted(dataset)?dataset.requestedAt??dataset.receivedAt:null;
    tx.objectStore('markets').put({symbol:dataset.symbol,source:dataset.source,timeframe:dataset.timeframe,bars:dataset.bars,savedAt:new Date().toISOString(),...(requestedAt?{requestedAt,receivedAt:requestedAt,expiresAt:new Date(Date.parse(requestedAt)+derivCacheTTL).toISOString()}:{})});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return true;}
  catch{return false;}
}
