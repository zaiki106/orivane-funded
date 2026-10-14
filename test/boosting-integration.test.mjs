import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {calibrateDecision,classes,featureNames,decide} from '../src/decision.mjs';
import {fitBoostedStumps,boostingAlgorithm} from '../src/boosted-stumps.mjs';
import {classificationSamples} from '../src/decision.mjs';
const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url))),options={boosting:true,classCalibration:true,iterations:30},model=calibrateDecision(dataset,options);
test('six model families compete only on calibration, with an independently trained boosted classifier',()=>{
 assert.equal(new Set(model.selection.candidates.map(c=>c.algorithm)).size,6);assert.equal(model.selection.candidates.length,12);
 const train=classificationSamples(dataset.bars).filter(r=>r.index<model.split.train.end&&r.labelEndIndex<model.split.train.end);
 assert.deepEqual(model.boosted,fitBoostedStumps(train,model.scaler));assert.equal(model.selection.holdoutUsed,false);
});
test('held-out prices cannot alter boosted trees, calibration or classifier selection',()=>{
 const changed=structuredClone(dataset);for(let i=model.split.calibration.end;i<changed.bars.length;i++)for(const k of ['open','high','low','close'])changed.bars[i][k]*=1.3+(i%3)*.01;
 const second=calibrateDecision(changed,options);for(const key of ['boosted','selection','classCalibration','scaler'])assert.deepEqual(second[key],model[key],key);
 assert.notDeepEqual(second.test,model.test);
});
test('selected boosting retains all closed-candle, data freshness and confidence guards',()=>{
 const selected={...structuredClone(model),algorithm:boostingAlgorithm},d=decide(dataset.bars,selected);
 assert.equal(decide(dataset.bars,selected,{fresh:false}).side,'HOLD');
 const forming={...dataset.bars.at(-1),closed:false,time:new Date(Date.parse(dataset.bars.at(-1).time)+900000).toISOString(),high:900,low:1,close:800};assert.deepEqual(decide([...dataset.bars,forming],selected),d);
 if(d.side!=='HOLD')assert.ok(d.confidence.percent>60);
 const bad=structuredClone(selected);bad.boosted.trees[0].left=NaN;assert.equal(decide(dataset.bars,bad).confidence.classProbs,null);
});
