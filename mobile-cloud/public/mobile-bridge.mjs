let modelWorker=new Worker('/mobile-model-worker.mjs?v=wallstreet12',{type:'module'}),activeModel=null;
const worker=new Worker('/mobile-engine.mjs?v=wallstreet12',{type:'module'}),waiters=new Map(),streams=new Set();let latest=null,serial=0;
let saved=null,priorPrivate=null;
try{priorPrivate=localStorage.getItem('orivane.mobile.private.v1');}catch{saved={schemaVersion:'unreadable-storage'};}
if(priorPrivate){
 try{saved=JSON.parse(priorPrivate);if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={schemaVersion:'invalid-storage-json'};}catch{saved={schemaVersion:'invalid-storage-json'};}
 try{if(!localStorage.getItem('orivane.mobile.private.backup.v1'))localStorage.setItem('orivane.mobile.private.backup.v1',priorPrivate);}catch{}
}
worker.onmessage=event=>{const m=event.data;if(m.type==='private-restore-error'){try{const prior=localStorage.getItem('orivane.mobile.private.v1');if(prior)localStorage.setItem('orivane.mobile.private.restore-failed.v1',prior);}catch{}return;}if(m.type==='model-request'){activeModel={symbol:m.symbol,version:m.version};modelWorker.postMessage(m);return;}if(m.type==='state'){latest=m.state;for(const source of streams)source.listener?.({data:JSON.stringify(latest)});}if(m.type==='saved'){try{localStorage.setItem('orivane.mobile.private.v1',JSON.stringify(m.value));}catch{}}if(m.type==='reply'){const q=waiters.get(m.id);if(q){clearTimeout(q.timer);waiters.delete(m.id);m.error?q.reject(Error(m.error)):q.resolve(m.value);}}};
worker.onerror=()=>{latest=null;for(const s of streams)s.onerror?.();};
worker.postMessage({type:'init',saved});
export function deviceApi(url,value){if(url==='/api/import'){try{const prior=localStorage.getItem('orivane.mobile.private.v1');if(prior)localStorage.setItem('orivane.mobile.private.backup.v1',prior);}catch{}}return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{waiters.delete(id);reject(Error('Calcul ou connexion interrompu'));},120000);waiters.set(id,{resolve,reject,timer});worker.postMessage({type:'api',id,url,value});});}
export class DeviceStateStream{constructor(){streams.add(this);}addEventListener(name,listener){if(name==='state'){this.listener=listener;if(latest)listener({data:JSON.stringify(latest)});}}close(){streams.delete(this);}}

function connectModelWorker(){
 const instance=modelWorker;
 instance.onmessage=({data:m})=>{if(instance!==modelWorker)return;worker.postMessage(m);if(m.type==='model-complete'||m.type==='model-error')activeModel=null;};
 instance.onerror=()=>{if(instance!==modelWorker)return;const failed=activeModel;activeModel=null;instance.terminate();modelWorker=new Worker('/mobile-model-worker.mjs?v=wallstreet12',{type:'module'});connectModelWorker();if(failed)worker.postMessage({type:'model-error',...failed});};
}
connectModelWorker();
