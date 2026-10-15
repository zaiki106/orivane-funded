let modelWorker=null,worker=null,activeModel=null;
const waiters=new Map(),streams=new Set();let latest=null,serial=0;
let restartTimer=null,modelRestartTimer=null,watchdogTimer=null,restartAttempts=0,modelRestartAttempts=0;
let initializedAt=0,lastStateAt=0,lastObservedAt=Date.now(),hiddenSince=null,resumePending=false;
const delay=attempt=>Math.min(30000,1000*2**Math.min(attempt,5));
const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
function notifyError(){for(const source of streams)try{source.onerror?.();}catch{}}
function terminate(instance){if(instance)try{instance.terminate();}catch{}}
function rejectWaiters(){for(const q of waiters.values()){clearTimeout(q.timer);q.reject(Error('Moteur mobile redémarré ; réessayez la demande.'));}waiters.clear();}
let saved=null,priorPrivate=null;
try{priorPrivate=localStorage.getItem('orivane.mobile.private.v1');}catch{saved={schemaVersion:'unreadable-storage'};}
if(priorPrivate){
 try{saved=JSON.parse(priorPrivate);if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={schemaVersion:'invalid-storage-json'};}catch{saved={schemaVersion:'invalid-storage-json'};}
 try{if(!localStorage.getItem('orivane.mobile.private.backup.v1'))localStorage.setItem('orivane.mobile.private.backup.v1',priorPrivate);}catch{}
}
function postEngine(message){if(!worker)return false;try{worker.postMessage(message);return true;}catch{restartEngine();return false;}}
function restartEngine(){
 if(restartTimer!==null)return;
 latest=null;lastStateAt=0;rejectWaiters();
 const prior=worker;worker=null;terminate(prior);
 const priorModel=modelWorker;modelWorker=null;terminate(priorModel);activeModel=null;
 clearTimeout(modelRestartTimer);modelRestartTimer=null;
 const wait=delay(restartAttempts++);
 restartTimer=setTimeout(()=>{restartTimer=null;startEngine();},wait);
 notifyError();
}
function restartModel(){
 if(modelRestartTimer!==null)return;
 const failed=activeModel;activeModel=null;const prior=modelWorker;modelWorker=null;terminate(prior);
 if(failed)postEngine({type:'model-error',...failed});
 if(!worker)return;
 // Preserve immediate recovery for a first failed calculation. Repeated model
 // failures back off, so an unavailable module cannot create a restart loop.
 const wait=modelRestartAttempts++===0?0:delay(modelRestartAttempts-2);
 if(wait===0){try{connectModelWorker();}catch{restartModel();}}
 else modelRestartTimer=setTimeout(()=>{modelRestartTimer=null;try{connectModelWorker();}catch{restartModel();}},wait);
}
function connectModelWorker(){
 const instance=new Worker('/mobile-model-worker.mjs?v=intelligence-mobile3',{type:'module'});modelWorker=instance;
 instance.onmessage=({data:m})=>{
  if(instance!==modelWorker||!m)return;
  postEngine(m);
  if(m.type==='model-complete'||m.type==='model-error'){activeModel=null;modelRestartAttempts=0;}
 };
 instance.onerror=instance.onmessageerror=()=>{if(instance===modelWorker)restartModel();};
}
function startEngine(){
 try{
  connectModelWorker();
  const instance=new Worker('/mobile-engine.mjs?v=intelligence-mobile3',{type:'module'});worker=instance;
  initializedAt=Date.now();lastStateAt=0;lastObservedAt=initializedAt;
  instance.onmessage=event=>{
   if(instance!==worker)return;const m=event.data;if(!m||typeof m!=='object')return;
   if(m.type==='private-restore-error'){try{const prior=localStorage.getItem('orivane.mobile.private.v1');if(prior)localStorage.setItem('orivane.mobile.private.restore-failed.v1',prior);}catch{}return;}
   if(m.type==='model-request'){
    if(!modelWorker){postEngine({type:'model-error',symbol:m.symbol,version:m.version});return;}
    activeModel={symbol:m.symbol,version:m.version};try{modelWorker.postMessage(m);}catch{restartModel();}return;
   }
   if(m.type==='state'){
    lastStateAt=Date.now();if(lastStateAt-initializedAt>=30000)restartAttempts=0;
    latest=m.state;for(const source of streams)try{source.listener?.({data:JSON.stringify(latest)});}catch{}
   }
   if(m.type==='saved'){saved=m.value;try{localStorage.setItem('orivane.mobile.private.v1',JSON.stringify(m.value));}catch{}}
   if(m.type==='reply'){const q=waiters.get(m.id);if(q){clearTimeout(q.timer);waiters.delete(m.id);m.error?q.reject(Error(m.error)):q.resolve(m.value);}}
  };
  instance.onerror=instance.onmessageerror=()=>{if(instance===worker)restartEngine();};
  instance.postMessage({type:'init',saved});
  if(resumePending){resumePending=false;postEngine({type:'resume'});}
 }catch{restartEngine();}
}
export function deviceApi(url,value){if(url==='/api/import'){try{const prior=localStorage.getItem('orivane.mobile.private.v1');if(prior)localStorage.setItem('orivane.mobile.private.backup.v1',prior);}catch{}}return new Promise((resolve,reject)=>{
 if(!worker){reject(Error('Moteur mobile en cours de reconnexion ; réessayez.'));return;}
 const id=++serial,timer=setTimeout(()=>{waiters.delete(id);reject(Error('Calcul ou connexion interrompu'));},120000);
 waiters.set(id,{resolve,reject,timer});postEngine({type:'api',id,url,value});
});}
export class DeviceStateStream{constructor(){streams.add(this);}addEventListener(name,listener){if(name==='state'){this.listener=listener;if(latest)listener({data:JSON.stringify(latest)});}}close(){streams.delete(this);}}

function resume(){
 if(!visible())return;
 const now=Date.now(),suspendedFor=now-(hiddenSince??lastObservedAt);hiddenSince=null;lastObservedAt=now;
 resumePending=true;
 if(suspendedFor>30000&&worker)restartEngine();
 if(worker){resumePending=false;postEngine({type:'resume'});}
}
function supervise(){
 if(watchdogTimer!==null)return;
 watchdogTimer=setTimeout(()=>{
  watchdogTimer=null;
  if(visible()){lastObservedAt=Date.now();if(worker&&lastObservedAt-(lastStateAt||initializedAt)>=30000)restartEngine();}
  supervise();
 },15000);
}
startEngine();
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
 document.addEventListener('visibilitychange',()=>{if(visible())resume();else hiddenSince=Date.now();});
 supervise();
}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
 window.addEventListener('online',resume);window.addEventListener('pageshow',resume);
}
