import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,defaultProfile} from '../src/server.mjs';
import {classes,featureNames,featureWindow,decisionVersion} from '../src/decision.mjs';

test('paper floating equity and closed PNL both charge fixed dollars per forex unit',async()=>{
  const before=process.env.ORIVANE_COST_PROFILE;process.env.ORIVANE_COST_PROFILE='the5ers';let app;
  try{
    const start=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:61},(_,i)=>({time:new Date(start-(61-i)*900000).toISOString(),open:1.1,high:i===60?1.105:1.101,low:1.099,close:i===60?1.104:1.1,volume:100}));
    const d={symbol:'EUR/USD',source:'Explicit paper integration fixture',timeframe:15,live:true,bars,quote:{price:1.104,receivedAt:new Date().toISOString(),transport:'websocket'}};
    const pool=options=>({schedule:(dataset,version)=>options.onCalibration({symbol:dataset.symbol,source:dataset.source,version,trainedAt:new Date().toISOString(),calibration:{version:decisionVersion,symbol:dataset.symbol,source:dataset.source,classes:[...classes],featureWindow,status:'estimate',audited:true,test:{sample:100,brier:.4,baselineBrier:.5},calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:[.8,.1,.1].map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}}}),snapshot:()=>({active:0,queued:0,concurrency:1}),close:async()=>{}});
    app=createApp({dbPath:':memory:',network:false,initialDatasets:[d],importsPath:'',modelPoolFactory:pool});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(r=>r.json()),market=state.radar.find(m=>m.symbol==='EUR/USD');assert.equal(market.decision.side,'BUY');
    const post=(url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(data)});
    assert.equal((await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['EUR/USD']})).status,200);
    const opened=await post('/api/paper/open',{symbol:'EUR/USD',strategy:market.decision.strategy});assert.equal(opened.status,201,JSON.stringify(await opened.clone().json()));const p=await opened.json();
    assert.equal(p.cost.feePerUnit,.00002);assert.equal(p.feeBps,0);
    const floating=await fetch(base+'/api/state').then(r=>r.json()),expectedFloating=(1.104-p.entry)*p.quantity-4*p.quantity/100000;
    assert.ok(Math.abs(floating.account.floating-expectedFloating)<1e-8);
    assert.equal((await post('/api/paper/close',{id:p.id})).status,200);
    const closed=await fetch(base+'/api/state').then(r=>r.json()),position=closed.positions[0],expected=(position.exit-p.entry)*p.quantity-4*p.quantity/100000;
    assert.ok(Math.abs(position.pnl-expected)<1e-8);assert.ok(Math.abs(closed.account.realized-expected)<1e-8);
  }finally{await app?.close();if(before===undefined)delete process.env.ORIVANE_COST_PROFILE;else process.env.ORIVANE_COST_PROFILE=before;}
});
