// Only received, closed provider candles are retained. Quotes are never cached.
export function mergeHistory(previous, incoming, limit=5000) {
  const older=previous?.symbol===incoming.symbol&&previous?.source===incoming.source&&previous?.timeframe===incoming.timeframe?previous.bars:[];
  return [...new Map([...(older??[]),...incoming.bars].filter(b=>b.closed!==false).map(b=>[b.time,b])).values()]
    .sort((a,b)=>a.time.localeCompare(b.time)).slice(-limit);
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
  try {const db=await open();return await new Promise((resolve,reject)=>{const r=db.transaction('markets','readonly').objectStore('markets').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  catch{return [];}
}
export async function saveHistory(dataset){
  try {const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('markets','readwrite');tx.objectStore('markets').put({symbol:dataset.symbol,source:dataset.source,timeframe:dataset.timeframe,bars:dataset.bars,savedAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return true;}
  catch{return false;}
}
