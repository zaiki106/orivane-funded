import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/mobile-bridge.mjs',import.meta.url),'utf8').replace(/export /g,'');
const key='orivane.mobile.private.v1';
function environment({journal=null,hidden=false,writeFails=false,failEngineCreations=0}={}){
 let now=100000,id=0;const timers=new Map(),workers=[],memory=new Map(journal===null?[]:[[key,journal]]);
 const host=()=>{const listeners=new Map();return {addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},dispatch(name){for(const fn of listeners.get(name)??[])fn();}};};
 const document={...host(),visibilityState:hidden?'hidden':'visible'},window=host();
 class Clock extends Date{static now(){return now;}}
 class Worker{constructor(url){if(url.startsWith('/mobile-engine.mjs')&&failEngineCreations-->0)throw Error('Unavailable engine module');this.url=url;this.sent=[];this.terminated=false;workers.push(this);}postMessage(value){if(this.terminated)throw Error('Worker terminated');this.sent.push(structuredClone(value));}terminate(){this.terminated=true;}}
 const context=vm.createContext({Worker,Date:Clock,document,window,localStorage:{getItem:k=>memory.get(k)??null,setItem(k,v){if(writeFails)throw Error('QuotaExceededError');memory.set(k,v);}},setTimeout(fn,ms){const timer=++id;timers.set(timer,{at:now+ms,fn});return timer;},clearTimeout(timer){timers.delete(timer);},Map,Set,Promise,JSON,Error});
 vm.runInContext(source,context);
 return {context,workers,memory,timers,document,window,engine:()=>workers.filter(w=>w.url.startsWith('/mobile-engine.mjs')).at(-1),model:()=>workers.filter(w=>w.url.startsWith('/mobile-model-worker.mjs')).at(-1),api:(url,value)=>context.deviceApi(url,value),stream:()=>vm.runInContext('new DeviceStateStream()',context),advance(ms){const end=now+ms;let count=0;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++count>1000)throw Error('Timer loop');now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};
}
test('main crash rejects pending calls, notifies streams and starts exactly one fresh engine/model pair',async()=>{
 const e=environment(),engine=e.engine(),model=e.model(),stream=e.stream();let errors=0;stream.onerror=()=>errors++;
 const pending=assert.rejects(e.api('/api/runtime'),/redémarré/);
 engine.onerror();engine.onmessageerror();assert.equal(errors,1);assert.equal(engine.terminated,true);assert.equal(model.terminated,true);
 await pending;await assert.rejects(e.api('/api/runtime'),/reconnexion/);
 e.advance(999);assert.equal(e.workers.length,2);e.advance(1);assert.equal(e.workers.length,4);
 assert.notEqual(e.engine(),engine);assert.equal(e.engine().sent[0].type,'init');assert.equal(e.timers.size,1);
 // Superseded worker messages and errors cannot restart or overwrite new state.
 engine.onmessage({data:{type:'saved',value:{corrupt:true}}});engine.onerror();assert.equal(e.memory.has(key),false);assert.equal(e.workers.length,4);
});
test('valid and blocked private journals survive restarts with their existing storage keys',()=>{
 for(const journal of [JSON.stringify({profile:{name:'Private journal'},positions:[],history:[]}),'{invalid json']){
  const e=environment({journal}),original=e.engine().sent[0].saved;
  e.engine().onmessage({data:{type:'private-restore-error'}});e.engine().onmessageerror();e.advance(1000);
  assert.deepEqual(e.engine().sent[0].saved,original);assert.equal(e.memory.get(key),journal);
  assert.equal(e.memory.get('orivane.mobile.private.backup.v1'),journal);
  assert.equal(e.memory.get('orivane.mobile.private.restore-failed.v1'),journal);
 }
});
test('latest in-memory private save survives a quota error and engine recovery',()=>{
 const e=environment({journal:'{"positions":[]}',writeFails:true}),value={profile:{name:'Latest'},positions:[{id:'saved'}]};
 e.engine().onmessage({data:{type:'saved',value}});e.engine().onerror();e.advance(1000);
 assert.deepEqual(e.engine().sent[0].saved,value);assert.equal(e.memory.get(key),'{"positions":[]}');
});
test('hidden tabs do not trigger watchdog recovery; long resume restarts and refreshes the engine',()=>{
 const e=environment({hidden:true}),prior=e.engine();e.advance(120000);assert.equal(e.workers.length,2);
 e.document.visibilityState='visible';e.document.dispatch('visibilitychange');assert.equal(prior.terminated,true);
 e.advance(1000);assert.equal(e.workers.length,4);assert.equal(e.engine().sent.at(-1).type,'resume');
});
test('online/pageshow/short visibility resume refresh feeds without duplicate supervision timers',()=>{
 const e=environment(),engine=e.engine();e.advance(1000);
 for(let i=0;i<4;i++){e.window.dispatch('online');e.window.dispatch('pageshow');e.document.dispatch('visibilitychange');}
 assert.equal(e.workers.length,2);assert.equal(e.timers.size,1);
 assert.equal(engine.sent.filter(m=>m.type==='resume').length,12);
});
test('visible watchdog uses actual state heartbeats and restarts a silent engine once',()=>{
 const e=environment();e.advance(15000);e.engine().onmessage({data:{type:'state',state:{radar:[]}}});
 e.advance(15000);assert.equal(e.workers.length,2);e.advance(15000);assert.equal(e.engine().terminated,true);
 assert.equal(e.timers.size,2);e.advance(1000);assert.equal(e.workers.length,4);assert.equal(e.timers.size,1);
});
test('successive immediate engine crashes back off exponentially with a 30 second cap',()=>{
 const e=environment();
 for(const wait of [1000,2000,4000,8000,16000,30000,30000]){
  const prior=e.engine(),count=e.workers.length;prior.onerror();prior.onmessageerror();
  e.advance(wait-1);assert.equal(e.workers.length,count);e.advance(1);assert.equal(e.workers.length,count+2);
 }
});
test('recovery clears active model work and ignores stale model replies',()=>{
 const e=environment(),oldModel=e.model(),oldEngine=e.engine();
 oldEngine.onmessage({data:{type:'model-request',symbol:'BTC/USD',version:3}});
 oldEngine.onerror();e.advance(1000);const nextEngine=e.engine(),sent=nextEngine.sent.length;
 oldModel.onmessage({data:{type:'model-complete',symbol:'BTC/USD',version:3}});assert.equal(nextEngine.sent.length,sent);
 nextEngine.onmessage({data:{type:'model-request',symbol:'EUR/USD',version:4}});e.model().onmessageerror();
 assert.deepEqual(nextEngine.sent.at(-1),{type:'model-error',symbol:'EUR/USD',version:4});
});
test('engine construction failures are retried with backoff and abandoned model workers terminate',()=>{
 const e=environment({failEngineCreations:2});assert.equal(e.workers.length,1);assert.equal(e.model().terminated,true);
 e.advance(1000);assert.equal(e.workers.length,2);assert.equal(e.model().terminated,true);
 e.advance(1999);assert.equal(e.engine(),undefined);e.advance(1);
 assert.equal(e.workers.length,4);assert.equal(e.engine().sent[0].type,'init');assert.equal(e.timers.size,1);
});
test('a continuously responsive engine resets crash backoff after thirty healthy seconds',()=>{
 const e=environment();e.engine().onerror();e.advance(1000);
 for(let i=0;i<3;i++){e.advance(10000);e.engine().onmessage({data:{type:'state',state:{radar:[]}}});}
 const count=e.workers.length;e.engine().onerror();e.advance(999);assert.equal(e.workers.length,count);
 e.advance(1);assert.equal(e.workers.length,count+2);
});
