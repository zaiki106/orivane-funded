import test from 'node:test';
import assert from 'node:assert/strict';
import {runResearchBatch} from '../src/intelligence-jobs.mjs';
const start=Date.parse('2024-01-01T00:00:00Z'),step=900000,asOf=start+320*step;
function dataset(symbol='BTC/USD') {return {symbol,source:'synthetic batch regression fixture',synthetic:true,timeframe:15,bars:Array.from({length:320},(_,i)=>({time:new Date(start+i*step).toISOString(),open:100,high:101,low:99,close:100,volume:100,closed:true}))};}
test('one and two workers produce identical reports in original source order',async()=>{
 const inputs=[dataset(),dataset('EUR/USD')],before=structuredClone(inputs);
 const serial=await runResearchBatch(inputs,{workers:1,asOf}),parallel=await runResearchBatch(inputs,{workers:2,asOf});
 assert.equal(serial.workers,1);assert.equal(parallel.workers,2);
 assert.equal(parallel.kind,'intelligence-batch');assert.equal(parallel.completed,2,JSON.stringify(parallel.results));assert.equal(parallel.failed,0);
 assert.deepEqual(parallel.results,serial.results);assert.deepEqual(inputs,before);
 assert.deepEqual(parallel.results.map(r=>r.index),[0,1]);
 assert.ok(parallel.results.every(r=>r.status==='completed'&&r.report.status==='insufficient'&&r.report.policy.realTradingAuthorized===false));
});
test('malformed individual datasets and clone errors do not cancel valid jobs',async()=>{
 const bad=dataset('UNKNOWN'),uncloneable={...dataset(),bad:()=>0};
 const batch=await runResearchBatch([bad,dataset(),null,uncloneable],{workers:2,asOf});
 assert.equal(batch.completed,1);assert.equal(batch.failed,3);
 assert.deepEqual(batch.results.map(r=>r.status),['failed','completed','failed','failed']);
 assert.ok(batch.results.filter(r=>r.status==='failed').every(r=>typeof r.error==='string'&&r.error.length>0));
});
test('progress is advisory and concurrent slots obey the requested bound',async()=>{
 const events=[];
 const batch=await runResearchBatch([dataset(),dataset('EUR/USD'),dataset('GBP/USD')],{workers:2,asOf,onProgress:event=>{events.push(event);if(event.status==='running')throw Error('advisory observer failure');return Promise.reject(Error('ignored asynchronous observer failure'));}});
 assert.equal(batch.completed,3);assert.ok(events.every(e=>e.active<=2&&e.active>=0));
 assert.equal(events.filter(e=>e.status==='running').length,3);assert.equal(events.filter(e=>e.status==='completed').length,3);
 assert.equal(events.at(-1).active,0);assert.equal(events.at(-1).completed,3);
});
test('batch controls and resource caps reject before worker creation',async()=>{
 for(const options of [{workers:0},{workers:5},{workers:1.5},{timeoutMs:99},{timeoutMs:300001},{asOf:NaN},{onProgress:null}])await assert.rejects(runResearchBatch([],{asOf,...options}));
 await assert.rejects(runResearchBatch(null));
 await assert.rejects(runResearchBatch(Array(9).fill(null),{asOf}));
 await assert.rejects(runResearchBatch([{bars:Array(20001)}],{asOf}));
 await assert.rejects(runResearchBatch(Array.from({length:3},()=>({bars:Array(20000)})),{asOf}));
 assert.deepEqual(await runResearchBatch([],{asOf}),{kind:'intelligence-batch',workers:0,results:[],completed:0,failed:0});
});
test('controlled parent timer deterministically times out and terminates a real worker',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 try{
  const events=[],pending=runResearchBatch([dataset()],{workers:1,asOf,timeoutMs:100,onProgress:event=>events.push(event)});
  // No event-loop yield occurs before the tick, so a real worker cannot have
  // delivered its result to this thread before the controlled timeout fires.
  context.mock.timers.tick(100);
  const result=await pending;
  assert.equal(result.completed,0);assert.equal(result.failed,1);
  assert.equal(result.results[0].status,'timeout');assert.match(result.results[0].error,/100 ms/);
  assert.equal(events.at(-1).active,0);assert.equal(events.at(-1).status,'timeout');
 }finally{context.mock.timers.reset();}
});
test('later inputs are snapshotted before advisory callbacks can mutate them',async()=>{
 const inputs=[dataset(),dataset('EUR/USD')];
 const result=await runResearchBatch(inputs,{workers:1,asOf,onProgress:event=>{if(event.index===0&&event.status==='running'){inputs[1].symbol='UNKNOWN';inputs[1].bars.length=0;}}});
 assert.equal(result.completed,2);assert.equal(result.results[1].symbol,'EUR/USD');
 assert.equal(result.results[1].report.bars,320);
});
