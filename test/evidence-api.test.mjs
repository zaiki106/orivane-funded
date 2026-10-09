import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {metrics,strategies} from '../src/engine.mjs';
import {strategyEvidence} from '../src/strategy-evidence.mjs';

test('historical evidence waits for the matching laboratory and rejects obsolete version, source and coverage',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0}));
  const dataset={symbol:'EUR/USD',source:'Evidence integration fixture',timeframe:15,bars},trades=Array.from({length:20},(_,i)=>({time:bars[76+i].time,exitTime:bars[77+i].time,r:i%2?-.8:1.2}));
  const report={...metrics(trades),trades},lab={symbol:dataset.symbol,source:dataset.source,from:bars[0].time,to:bars.at(-1).time,bars:bars.length,results:strategies.map(rule=>({id:rule.id,name:rule.name,train:null,validation:null,test:report,cost:{feeBps:2,slippageBps:2,assumption:true}}))};
  let callbacks;const jobs=[];
  const app=createApp({dbPath:':memory:',network:false,importsPath:'',initialDatasets:[dataset],modelPoolFactory:options=>{callbacks=options;return {schedule:(d,version)=>jobs.push({dataset:d,version}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}};}});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+app.server.address().port,state=()=>fetch(base+'/api/state').then(r=>r.json()),market=async()=>(await state()).radar.find(m=>m.symbol===dataset.symbol),job=jobs.find(j=>j.dataset.symbol===dataset.symbol);
    const completed={symbol:dataset.symbol,source:dataset.source,version:job.version,calibration:null,laboratory:lab,trainedAt:new Date().toISOString()};
    assert.equal((await market()).strategyEvidence?.status,'unavailable');
    callbacks.onCalibration({...completed,laboratory:undefined});assert.equal((await market()).strategyEvidence.status,'unavailable');
    for(const invalid of [{...completed,version:job.version-1},{...completed,source:'Wrong source'},{...completed,laboratory:{...lab,source:'Wrong source'}},{...completed,laboratory:{...lab,to:bars.at(-2).time}},{...completed,laboratory:{...lab,symbol:'GBP/USD'}}]){
      callbacks.onResult(invalid);assert.equal((await market()).strategyEvidence.status,'unavailable');
    }
    callbacks.onResult(completed);const m=await market();
    assert.deepEqual(m.strategyEvidence,strategyEvidence(lab,m.decision.strategy));
    assert.equal(m.strategyEvidence.status,'available');assert.equal(m.strategyEvidence.sample,20);
    assert.ok(!('trades'in m.strategyEvidence));assert.ok(!('confidence'in m.strategyEvidence));
    callbacks.onResult({...completed,version:job.version-1,laboratory:{...lab,results:[]}});assert.deepEqual((await market()).strategyEvidence,m.strategyEvidence);
    callbacks.onError({...completed,error:'fixture failure'});assert.equal((await market()).strategyEvidence.status,'unavailable');
    for(const row of (await state()).radar)assert.ok(row.strategyEvidence);
  }finally{await app.close();}
});
