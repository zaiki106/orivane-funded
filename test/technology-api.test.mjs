import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {decisionVersion,classes,featureNames,featureWindow} from '../src/decision.mjs';
import {DERIV_SOURCE} from '../src/deriv-feed.mjs';

const noDeriv=()=>({seed(){},start(){},stop(){},snapshot:()=>({status:'disabled'})});
const noNews=()=>({start(){},stop(){},snapshot:()=>({status:'unavailable',items:[],sources:[]})});
const pool=options=>({schedule:(d,version)=>options.onCalibration({symbol:d.symbol,source:d.source,version,calibration:{version:decisionVersion,symbol:d.symbol,source:d.source,classes:[...classes],featureWindow,status:'estimate',audited:true,test:{sample:100,brier:.4,baselineBrier:.5},calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:[.8,.1,.1].map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}},trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});
async function listen(app){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+app.server.address().port;}

test('health and observed-level API expose honest unavailable placeholders without retrospective outcomes',async()=>{
  const app=createApp({dbPath:':memory:',network:false,importsPath:'',modelPoolFactory:pool});
  try{
    const base=await listen(app),state=await fetch(base+'/api/state').then(r=>r.json()),health=await fetch(base+'/api/health').then(r=>r.json());
    assert.equal(health.markets.length,5);assert.deepEqual(state.marketHealth.map(m=>m.symbol),health.markets.map(m=>m.symbol));
    const absent=health.markets.find(m=>m.symbol==='EUR/USD');assert.equal(absent.state,'unavailable');assert.equal(absent.spread,null);assert.equal(absent.quoteAgeMs,null);
    const followups=await fetch(base+'/api/followups').then(r=>r.json());assert.equal(followups.mode,'observed-levels');assert.deepEqual(followups.items,[]);assert.equal(followups.summary.total,0);assert.deepEqual(state.signalFollowup,followups);
    for(const url of ['/api/health?symbol=QQQ','/api/followups?symbol=QQQ'])assert.equal((await fetch(base+url)).status,400);
    const code=await fetch(base+'/signal-alerts.js');assert.equal(code.status,200);assert.match(code.headers.get('content-type'),/javascript/);
  }finally{await app.close();}
});

test('a genuine newly observed signal is followed on subsequent quotes and survives restart without becoming a trade',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'orivane-followup-api-')),dbPath=path.join(dir,'test.sqlite'),begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:(i===99?104:100)+1,low:99,close:i===99?104:100,volume:i===99?200:100}));
  const fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  let onQuote;const feed=options=>{onQuote=options.onUpdate;return {seed(){},start(){const stamp=new Date().toISOString();onQuote({symbol:fixture.symbol,quote:{...fixture.quote,receivedAt:stamp,localReceivedAt:stamp}});},stop(){},snapshot:()=>({status:'live',provider:'Kraken WebSocket v2',transport:'websocket',ageMs:0,currentBar:null})};};
  let app=createApp({dbPath,network:true,initialDatasets:[fixture],importsPath:path.join(dir,'none'),liveFeedFactory:feed,derivFeedFactory:noDeriv,newsServiceFactory:noNews,modelPoolFactory:pool});
  try{
    let base=await listen(app);await new Promise(resolve=>setTimeout(resolve,2150));
    const tracked=await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json());assert.equal(tracked.items.length,1);const item=tracked.items[0];assert.equal(item.status,'watching');assert.equal(item.observedPrice,null);assert.equal(item.confidencePercent,80);
    const history=await fetch(base+'/api/signals?symbol=BTC%2FUSD').then(r=>r.json());assert.equal(history.items[0].id,item.id);assert.equal(history.items[0].horizonEndAt,item.horizonEndAt);
    const quotePrice=item.target+1,stamp=new Date().toISOString();onQuote({symbol:fixture.symbol,quote:{price:quotePrice,receivedAt:stamp,localReceivedAt:stamp,transport:'websocket'}});
    // A received crossing must survive a reversal before the next 1 Hz push.
    await new Promise(resolve=>setTimeout(resolve,5));const reversalStamp=new Date().toISOString();
    onQuote({symbol:fixture.symbol,quote:{price:item.entry,receivedAt:reversalStamp,localReceivedAt:reversalStamp,transport:'websocket'}});
    await new Promise(resolve=>setTimeout(resolve,1150));const after=await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json());assert.equal(after.items[0].status,'target-observed');assert.equal(after.items[0].observedPrice,quotePrice);assert.equal(after.items[0].lastQuoteAt,stamp);assert.ok(Date.parse(after.items[0].observedAt)>=Date.parse(stamp));assert.equal(after.items[0].entry,item.entry);assert.equal(after.items[0].stop,item.stop);assert.equal(after.items[0].target,item.target);
    assert.deepEqual((await fetch(base+'/api/state').then(r=>r.json())).positions,[]);assert.ok(!('pnl'in after.items[0]));assert.ok(!('winRate'in after.summary));
    await app.close();app=createApp({dbPath,network:false,importsPath:path.join(dir,'none'),modelPoolFactory:pool});base=await listen(app);
    const restored=await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json());assert.deepEqual(restored.items,after.items);assert.equal(restored.summary.targetObserved,1);
    assert.equal((await fetch(base+'/api/export').then(r=>r.json())).signalFollowup.items[0].id,item.id);
  }finally{await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'orivane-followup-api-'));rmSync(dir,{recursive:true,force:true});}
});

test('a new closed candle with the same strategy and side creates its own immutable follow-up once',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T12:15:10.000Z')});
  const begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:(i===99?104:100)+1,low:99,close:i===99?104:100,volume:i===99?200:100}));
  const fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  let onQuote,onClosedBar;
  const feed=options=>{onQuote=options.onUpdate;onClosedBar=options.onClosedBar;return {seed(){},start(){const stamp=new Date().toISOString();onQuote({symbol:fixture.symbol,quote:{...fixture.quote,receivedAt:stamp,localReceivedAt:stamp}});},stop(){},snapshot:()=>({status:'live',provider:'Kraken WebSocket v2',transport:'websocket',currentBar:null})};};
  const app=createApp({dbPath:':memory:',network:true,initialDatasets:[fixture],importsPath:'',liveFeedFactory:feed,derivFeedFactory:noDeriv,newsServiceFactory:noNews,modelPoolFactory:pool});
  try{
    const base=await listen(app);await new Promise(resolve=>setTimeout(resolve,1150));
    const first=await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json());assert.equal(first.items.length,1);
    const original=first.items[0];assert.equal(original.side,'BUY');
    t.mock.timers.tick(900000);const stamp=new Date().toISOString();
    onQuote({symbol:fixture.symbol,quote:{price:108,receivedAt:stamp,localReceivedAt:stamp,transport:'websocket'}});
    onClosedBar(fixture.symbol,{time:new Date(begin).toISOString(),open:104,high:109,low:103,close:108,volume:200,closed:true});
    const current=(await fetch(base+'/api/state').then(r=>r.json())).radar.find(row=>row.symbol===fixture.symbol).decision;
    assert.equal(current.side,'BUY');assert.equal(current.strategy,original.strategy,'The regression requires the same routed rule, not a strategy transition');
    await new Promise(resolve=>setTimeout(resolve,1150));
    const next=await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json());assert.equal(next.items.length,2);
    const newer=next.items.find(item=>item.id!==original.id);assert.equal(newer.strategy,original.strategy);assert.equal(newer.side,original.side);
    assert.equal(newer.signalTime,new Date(begin).toISOString());assert.equal(newer.entry,108*1.0005);assert.equal(newer.entry,current.entry);assert.notEqual(newer.target,original.target);
    assert.equal(next.items.find(item=>item.id===original.id).target,original.target);
    await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal((await fetch(base+'/api/followups?symbol=BTC%2FUSD').then(r=>r.json())).items.length,2,'Repeated pushes must not duplicate either closed-bar decision');
  }finally{await app.close();t.mock.timers.reset();}
});

test('Deriv tracks a received crossing before reversal even when provider ticks share an epoch second',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T12:15:10.000Z')});
  const begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:(i===99?104:100)+1,low:99,close:i===99?104:100,volume:i===99?200:100}));
  const fixture={symbol:'EUR/USD',source:DERIV_SOURCE,timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  let onQuote,status='live';
  const feed=options=>{onQuote=options.onUpdate;return {seed(){},start(){const stamp=new Date().toISOString();onQuote({symbol:fixture.symbol,quote:{...fixture.quote,receivedAt:stamp,eventTime:stamp,localReceivedAt:stamp}});},stop(){},snapshot:()=>({status,provider:DERIV_SOURCE,transport:'websocket',currentBar:null})};};
  const app=createApp({dbPath:':memory:',network:true,initialDatasets:[fixture],importsPath:'',liveFeedFactory:noDeriv,derivFeedFactory:feed,newsServiceFactory:noNews,modelPoolFactory:pool});
  try{
    const base=await listen(app);await new Promise(resolve=>setTimeout(resolve,1150));
    const initial=await fetch(base+'/api/followups?symbol=EUR%2FUSD').then(r=>r.json());assert.equal(initial.items.length,1);const signal=initial.items[0];
    t.mock.timers.tick(1000);const epochStamp=new Date().toISOString();
    onQuote({symbol:fixture.symbol,quote:{price:signal.entry,receivedAt:epochStamp,eventTime:epochStamp,localReceivedAt:epochStamp,transport:'websocket'}});
    t.mock.timers.tick(10);const crossingReceipt=new Date().toISOString(),crossedPrice=signal.target+1;
    onQuote({symbol:fixture.symbol,quote:{price:crossedPrice,receivedAt:epochStamp,eventTime:epochStamp,localReceivedAt:crossingReceipt,transport:'websocket'}});
    t.mock.timers.tick(10);
    onQuote({symbol:fixture.symbol,quote:{price:signal.entry,receivedAt:epochStamp,eventTime:epochStamp,localReceivedAt:new Date().toISOString(),transport:'websocket'}});
    const after=await fetch(base+'/api/followups?symbol=EUR%2FUSD').then(r=>r.json());
    assert.equal(after.items[0].status,'target-observed');assert.equal(after.items[0].observedPrice,crossedPrice);
    assert.equal(after.items[0].lastQuoteAt,epochStamp);assert.equal(after.items[0].observedAt,crossingReceipt);
  }finally{await app.close();t.mock.timers.reset();}
});
