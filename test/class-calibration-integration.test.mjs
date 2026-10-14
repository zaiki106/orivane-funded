import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calibrateDecision,classificationSamples,predictMarketClass} from '../src/decision.mjs';
const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url)));
const options={classCalibration:true,iterations:30};
const model=calibrateDecision(dataset,options);
test('held-out prices cannot change class calibration, classifier selection or fitted parameters',()=>{
  const changed=structuredClone(dataset);
  for(let i=model.split.calibration.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.2+(i%5)*.01;
  const second=calibrateDecision(changed,options);
  for(const key of ['classCalibration','calibrationAdjustment','selection','weights','scaler','temperature'])assert.deepEqual(second[key],model[key],key);
  assert.notDeepEqual(second.test.directional,model.test.directional);
});
test('directional Brier reports equal independent one-vs-rest errors on the test partition',()=>{
  const rows=classificationSamples(dataset.bars).filter(r=>r.index>=model.split.test.start),errors={UP:0,DOWN:0,FLAT:0};
  for(const row of rows){const p=predictMarketClass(dataset.bars.slice(0,row.index+1),model);for(const key of Object.keys(errors))errors[key]+=(p[key]-(row.label===key?1:0))**2;}
  for(const key of Object.keys(errors)){
    assert.equal(model.test.directional[key].sample,rows.length);
    assert.equal(model.test.directional[key].positive,rows.filter(r=>r.label===key).length);
    assert.ok(Math.abs(model.test.directional[key].brier-errors[key]/rows.length)<1e-12);
  }
  assert.ok(Math.abs(Object.values(model.test.directional).reduce((s,r)=>s+r.brier,0)-model.test.brier)<1e-12);
});
