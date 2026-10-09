import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/server.mjs';
import {calibrateDecision} from '../src/decision.mjs';

test('the public AI contract names the selected trained classifier and exposes comparison without its internal training bank',async()=>{
  const history=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url))),closeStart=Math.floor(Date.now()/900000)*900000-900000,shift=closeStart-Date.parse(history.bars.at(-1).time),bars=history.bars.map(b=>({...b,time:new Date(Date.parse(b.time)+shift).toISOString()}));
  const fixture={symbol:'BTC/USD',source:'Historical AI integration fixture',timeframe:15,live:true,bars,quote:{price:bars.at(-1).close,receivedAt:new Date().toISOString()}},trained=calibrateDecision(fixture);
  assert.equal(trained.status,'estimate');assert.equal(trained.selection.candidates.length,11);
  assert.deepEqual([...new Set(trained.selection.candidates.map(c=>c.algorithm))].sort(),['multinomial-logistic','neural-network','regularized-lda','regularized-qda','weighted-knn']);
  const pool=options=>({schedule:(dataset,version)=>options.onCalibration({symbol:dataset.symbol,source:dataset.source,version,calibration:trained,trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],importsPath:'',modelPoolFactory:pool});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const diagnostics=await fetch(base+'/api/model?symbol=BTC%2FUSD').then(r=>r.json()),publicModel=diagnostics.markets.find(m=>m.symbol==='BTC/USD'),state=await fetch(base+'/api/state').then(r=>r.json()),market=state.radar[0];
    assert.equal(publicModel.algorithm,trained.algorithm);assert.deepEqual(publicModel.selection,trained.selection);
    assert.equal(publicModel.selection.partition,'calibration');assert.equal(publicModel.selection.holdoutUsed,false);
    const chosen=publicModel.selection.candidates.filter(c=>c.algorithm===trained.algorithm&&c.k===trained.neighborCount&&(c.shrinkage??null)===(trained.selection.selectedShrinkage??null)&&(c.hiddenUnits??null)===(trained.selection.selectedHiddenUnits??null));
    assert.equal(chosen.length,1);assert.equal(chosen[0].brier,Math.min(...publicModel.selection.candidates.map(c=>c.brier)));
    assert.equal(publicModel.calibrated,trained.algorithm!=='weighted-knn');
    for(const key of ['weights','scaler','neighbors','neural','discriminant','samples','features','covariance','cholesky'])assert.ok(!(key in publicModel));
    assert.equal(market.decision.confidence.algorithm,trained.algorithm);
    assert.equal(state.strategyCatalog.length,42);assert.ok(state.strategyCatalog.some(s=>s.id==='ichimoku'));
    assert.ok(market.decision.confidence.neighboursDetail.every(n=>!('features'in n)&&Date.parse(n.labelEndTime)<=Date.parse(trained.trainedThrough)));
  }finally{await app.close();}
});
