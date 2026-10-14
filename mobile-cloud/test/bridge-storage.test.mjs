import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const mainKey='orivane.mobile.private.v1';
const source=readFileSync(new URL('../public/mobile-bridge.mjs',import.meta.url),'utf8').replace(/export /g,'');
function bridge(storage){
 const workers=[];
 class Worker{constructor(url){this.url=url;this.sent=[];workers.push(this);}postMessage(value){this.sent.push(structuredClone(value));}terminate(){}}
 const context=vm.createContext({Worker,localStorage:storage,setTimeout,clearTimeout,Map,Set,Promise,JSON,Error});
 vm.runInContext(source,context);
 return workers.find(worker=>worker.url.startsWith('/mobile-engine.mjs'));
}
test('failed best-effort backup never prevents parsing a valid private journal',()=>{
 const saved={profile:{name:'Saved journal'},positions:[],history:[],followups:[],daily:{}},original=JSON.stringify(saved);
 const engine=bridge({getItem:key=>key===mainKey?original:null,setItem(){throw Error('QuotaExceededError');}});
 assert.deepEqual(engine.sent[0],{type:'init',saved});
});
test('invalid JSON and JSON primitives reach the worker as blocked restore sentinels',()=>{
 for(const original of ['{bad-json','null','[]','4','"value"']){
  const memory=new Map([[mainKey,original]]),engine=bridge({getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)});
  assert.equal(engine.sent[0].saved.schemaVersion,'invalid-storage-json');assert.equal(memory.get(mainKey),original);
  engine.onmessage({data:{type:'private-restore-error',error:'Version du journal incompatible'}});
  assert.equal(memory.get('orivane.mobile.private.restore-failed.v1'),original);assert.equal(memory.get(mainKey),original);
 }
});
test('unreadable storage remains an explicit restore failure rather than an empty journal',()=>{
 const engine=bridge({getItem(){throw Error('SecurityError');},setItem(){throw Error('SecurityError');}});
 assert.equal(engine.sent[0].saved.schemaVersion,'unreadable-storage');
});
test('missing journal initializes normally without creating a fake saved payload',()=>{
 const engine=bridge({getItem:()=>null,setItem(){throw Error('No write expected');}});
 assert.deepEqual(engine.sent[0],{type:'init',saved:null});
});
