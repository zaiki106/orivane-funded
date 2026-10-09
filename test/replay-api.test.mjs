import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {replayDecisions} from '../src/decision-replay.mjs';

test('replay API waits for matching provider/version/coverage and keeps simulation separate from live events',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000;
  const d={symbol:'EUR/USD',source:'Replay API fixture',timeframe:15,bars:Array.from({length:80},(_,i)=>({time:new Date(begin-(80-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0}))};
  let callbacks,job;
  const app=createApp({dbPath:':memory:',network:false,importsPath:'',initialDatasets:[d],modelPoolFactory:options=>{callbacks=options;return {schedule:(dataset,version)=>{if(dataset.symbol===d.symbol)job={dataset,version};},snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}};}});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const replay=()=>fetch(base+'/api/replay?symbol=EUR%2FUSD').then(r=>r.json());
    assert.equal((await replay()).status,'pending');
    const lab={symbol:d.symbol,source:d.source,bars:d.bars.length,from:d.bars[0].time,to:d.bars.at(-1).time,results:[]};
    const report=replayDecisions(d,null),result={symbol:d.symbol,source:d.source,version:job.version,trainedAt:new Date().toISOString(),calibration:null,laboratory:lab,replay:report};
    for(const bad of [{...result,version:job.version-1},{...result,source:'Wrong'},{...result,replay:{...report,bars:1}},{...result,replay:{...report,to:d.bars[0].time}}]){callbacks.onResult(bad);assert.ok(!('trades'in await replay()));}
    callbacks.onResult(result);const received=await replay();assert.equal(received.kind,'frozen-model-replay');assert.deepEqual(received.trades,[]);
    assert.equal(received.source,d.source);assert.equal(received.version,job.version);
    const state=await fetch(base+'/api/state').then(r=>r.json());assert.equal(state.radar.find(m=>m.symbol===d.symbol).replay.kind,received.kind);
    for(const market of state.radar.filter(m=>m.decisionChecks))assert.equal(market.decisionChecks.checks.find(c=>c.id==='feed').detail,market.feed.status);
    assert.deepEqual(state.signalHistory.items,[]);assert.deepEqual(state.signalFollowup.items,[]);
    assert.equal((await fetch(base+'/api/replay').then(r=>r.json())).markets.length,5);
    assert.equal((await fetch(base+'/api/replay?symbol=QQQ')).status,400);
    const diagnostics=await fetch(base+'/api/decision-checks').then(r=>r.json());
    assert.equal(diagnostics.markets.length,5);
    assert.ok(diagnostics.markets.every(m=>m.checks.length===7&&m.side==='HOLD'&&!m.ready));
    const one=await fetch(base+'/api/decision-checks?symbol=EUR%2FUSD').then(r=>r.json());
    assert.equal(one.markets.length,1);assert.equal(one.markets[0].source,d.source);
    assert.equal(one.markets[0].candleQuality.status,'complete');
    assert.equal(one.markets[0].candleQuality.scanned,80);
    assert.deepEqual(one.markets[0].candleQuality,state.radar.find(m=>m.symbol===d.symbol).decisionChecks.candleQuality);
    assert.equal((await fetch(base+'/api/decision-checks?symbol=QQQ')).status,400);
  }finally{await app.close();}
});
