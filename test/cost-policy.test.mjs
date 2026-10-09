import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,defaultProfile} from '../src/server.mjs';
import {calibrateDecision,decide,classes,featureNames,decisionVersion,featureWindow} from '../src/decision.mjs';

function breakoutDataset(symbol,start=Math.floor(Date.now()/900000)*900000){
  const bars=Array.from({length:100},(_,i)=>({time:new Date(start-(100-i)*900000).toISOString(),open:100,high:i===99?105:101,low:99,close:i===99?104:100,volume:i===99?200:100}));
  return {symbol,source:'Deterministic cost regression feed',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString()}};
}
function fixedModel(dataset,probabilities=[.8,.1,.1]){
  return {version:decisionVersion,symbol:dataset.symbol,source:dataset.source,classes:[...classes],featureWindow,status:'estimate',calibrated:true,audited:true,test:{sample:100,brier:.4,baselineBrier:.5},calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,
    weights:probabilities.map(value=>[Math.log(value),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)},
    event:{kind:'market_class_probability',description:'Direction nette à 60 min',horizonBars:4,horizonMinutes:60}};
}
const fixedModelPool=options=>({schedule:(dataset,version)=>options.onCalibration({symbol:dataset.symbol,source:dataset.source,version,calibration:fixedModel(dataset),trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});

test('FX, metals and crypto paper costs match the historical label assumptions and size actual positions',async()=>{
  for(const [symbol,feeBps,slippageBps] of [['BTC/USD',10,5],['EUR/USD',2,2],['GBP/USD',2,2],['XAU/USD',2,2]]){
    const fixture=breakoutDataset(symbol),labelModel=calibrateDecision(fixture);
    assert.deepEqual(labelModel.cost,{feeBps,slippageBps,assumption:true});
    const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory:fixedModelPool,importsPath:''});
    try{
      await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
      const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol===symbol);
      assert.equal(market.decision.side,'BUY',symbol+' '+market.decision.reason+' — A technical BUY and 80% model fixture isolate cost execution from confidence gating');
      const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});
      assert.equal((await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:[symbol]})).status,200);
      const response=await post('/api/paper/open',{symbol,strategy:market.decision.strategy}),position=await response.json();
      assert.equal(response.status,201,JSON.stringify(position));
      assert.equal(position.feeBps,feeBps);assert.equal(position.slippageBps,slippageBps);
      assert.deepEqual(position.cost,labelModel.cost);
      assert.equal(position.entry,104*(1+slippageBps/10000));
      assert.equal(market.decision.entry,position.entry,'The displayed executable entry must equal the paper fill');
      assert.equal(market.decision.stop,position.stop);assert.equal(market.decision.target,position.target);
      const stopFill=position.stop*(1-slippageBps/10000),expectedUnitRisk=position.entry-stopFill+(position.entry+stopFill)*feeBps/10000;
      assert.ok(Math.abs(position.quantity-Math.min(250/expectedUnitRisk,100000/position.entry))<1e-10,'Size uses the executable entry and net loss at the unchanged stop');
      assert.ok(Math.abs(position.unitRisk-expectedUnitRisk)<1e-10);
    }finally{await app.close();}
  }
});

test('current stop, target and excessive entry drift invalidate either direction without changing structural levels',()=>{
  const buy=breakoutDataset('BTC/USD');
  const sell={...buy,bars:buy.bars.map(bar=>({...bar,open:200-bar.open,high:200-bar.low,low:200-bar.high,close:200-bar.close}))};
  for(const [dataset,side,probabilities] of [[buy,'BUY',[.8,.1,.1]],[sell,'SELL',[.1,.8,.1]]]){
    const model=fixedModel(dataset,probabilities),raw=decide(dataset.bars,model),dir=side==='BUY'?1:-1;
    assert.equal(raw.side,side);
    for(const [price,flag,message] of [[raw.stop,'filteredByLevels',/Stop déjà franchi/],[raw.target,'filteredByLevels',/Objectif déjà atteint/],[raw.entry+dir*.51*raw.atr,'filteredByPrice',/0,5 ATR/]]){
      const guarded=decide(dataset.bars,model,{quote:{price},symbol:dataset.symbol});
      assert.equal(guarded.side,'HOLD');assert.equal(guarded[flag],true);assert.match(guarded.reason,message);
      assert.equal(guarded.confidence.class,'FLAT');assert.equal(guarded.setup.confirmed,false);
      assert.equal(guarded.entry,null);assert.equal(guarded.stop,null);assert.equal(guarded.target,null);
      assert.equal(guarded.confidenceGate.passed,true,'Invalidation must not alter the independent 80% confidence calculation');
      assert.equal(guarded.setup.stop,raw.stop);assert.equal(guarded.setup.target,raw.target);
      assert.deepEqual(guarded.checks,raw.checks);
    }
    const valid=decide(dataset.bars,model,{quote:{price:raw.entry},symbol:dataset.symbol});
    assert.equal(valid.side,side);assert.equal(valid.stop,raw.stop);assert.equal(valid.target,raw.target);
    assert.equal(valid.filteredByLevels,false);assert.equal(valid.filteredByPrice,false);
    const spreadQuote={price:raw.entry,[side==='BUY'?'ask':'bid']:raw.target};
    const spreadInvalidated=decide(dataset.bars,model,{quote:spreadQuote,symbol:dataset.symbol});
    assert.equal(spreadInvalidated.side,'HOLD');assert.equal(spreadInvalidated.filteredByLevels,true);
    assert.match(spreadInvalidated.reason,/Niveaux invalidés au prix d’entrée courant/);
  }
});

test('API radar and paper entry agree when the current quote has already crossed the signal stop',async()=>{
  const fixture=breakoutDataset('BTC/USD'),initial=decide(fixture.bars,fixedModel(fixture));
  assert.equal(initial.side,'BUY');fixture.quote.price=initial.stop;
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory:fixedModelPool,importsPath:''});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='BTC/USD');
    assert.equal(market.decision.side,'HOLD');assert.equal(market.decision.filteredByLevels,true);assert.match(market.decision.reason,/Stop déjà franchi/);
    assert.equal(market.signal.side,'HOLD');assert.equal(market.decision.setup.confirmed,false);
    const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});
    await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']});
    const response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:initial.strategy});
    assert.equal(response.status,422);assert.match((await response.json()).error,/Stop déjà franchi/);
    assert.equal((await fetch(base+'/api/state').then(result=>result.json())).positions.length,0);
  }finally{await app.close();}
});

test('session-validated canonical NDX snapshots replace previously cached out-of-session candles',async()=>{
  const legacy={...breakoutDataset('NDX'),source:'Yahoo Finance · Nasdaq-100 index',live:false},canonical={...legacy,bars:legacy.bars.slice(0,-1),provenance:{provider:'Yahoo Finance',mode:'snapshot',sessionValidated:true,historyMode:'canonical-provider-snapshot'}};
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[legacy,canonical],modelPoolFactory:fixedModelPool,importsPath:''});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const state=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='NDX');
    assert.equal(market.coverage,canonical.bars.length);assert.equal(market.asOf,canonical.bars.at(-1).time);
    assert.ok(market.bars.every(bar=>bar.time!==legacy.bars.at(-1).time),'The invalid old candle must not survive snapshot installation');
  }finally{await app.close();}
});

test('confidence horizon is anchored to the closed signal candle rather than read time or a forming candle',()=>{
  const dataset=breakoutDataset('EUR/USD',Date.UTC(2026,0,8,12,15)),model=fixedModel(dataset),decision=decide(dataset.bars,model);
  assert.equal(decision.confidence.referenceTime,'2026-01-08T12:15:00.000Z');
  assert.equal(decision.confidence.referencePrice,104);
  assert.equal(decision.confidence.horizonEndAt,'2026-01-08T13:15:00.000Z');
  const forming={time:'2026-01-08T12:15:00.000Z',open:104,high:107,low:103,close:106,volume:500,closed:false};
  const withForming=decide([...dataset.bars,forming],model);
  assert.equal(withForming.confidence.referenceTime,decision.confidence.referenceTime);
  assert.equal(withForming.confidence.referencePrice,104);
  assert.equal(withForming.confidence.horizonEndAt,decision.confidence.horizonEndAt);
  const empty=decide([],null);
  assert.equal(empty.confidence.referenceTime,null);assert.equal(empty.confidence.referencePrice,null);assert.equal(empty.confidence.horizonEndAt,null);
});
