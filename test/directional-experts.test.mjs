import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calibrateDecision,modelForDirection,predictMarketClass,decide} from '../src/decision.mjs';
import {assessDirection,applyModelAssessment} from '../src/model-assessment.mjs';
const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url))),options={boosting:true,classCalibration:true,directionalExperts:true,iterations:30},model=calibrateDecision(dataset,options);
test('each direction uses one classifier selected by its own calibration loss, with normalized probabilities',()=>{
 assert.equal(model.expertSelection.partition,'calibration');assert.equal(model.expertSelection.holdoutUsed,false);assert.equal(model.expertSelection.candidates.length,12);
 for(const direction of ['UP','DOWN']){const e=modelForDirection(model,direction),minimum=Math.min(...model.expertSelection.candidates.map(c=>c[direction]));
  assert.ok(e.calibration.directional[direction].brier<=minimum+1e-12);assert.equal(e.selection.class,direction);assert.equal(e.selection.holdoutUsed,false);
  const p=predictMarketClass(dataset.bars,e);assert.ok(Math.abs(p.UP+p.DOWN+p.FLAT-1)<1e-10);assert.equal(e.test.sample,model.test.sample);
 }
});
test('future holdout cannot change the selected directional predictors or their calibration',()=>{
 const changed=structuredClone(dataset);for(let i=model.split.calibration.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.2+i%5*.01;
 const other=calibrateDecision(changed,options);assert.deepEqual(other.expertSelection,model.expertSelection);
 for(const direction of ['UP','DOWN'])for(const key of ['algorithm','temperature','weights','scaler','neighbors','neighborCount','neural','boosted','discriminant','linearDiscriminant','classCalibration','calibration','selection'])assert.deepEqual(other.directionalExperts[direction][key],model.directionalExperts[direction][key],direction+' '+key);
 assert.notDeepEqual(other.directionalExperts.UP.test,model.directionalExperts.UP.test);
});
test('decision and publication assessment use the same event classifier and fail closed for mismatched experts',()=>{
 const d=decide(dataset.bars,model),direction=d.confidenceGate.candidateClass;
 if(direction){const e=modelForDirection(model,direction);assert.deepEqual(d.confidence.classProbs,predictMarketClass(dataset.bars,e));assert.equal(d.confidence.algorithm,e.algorithm);assert.equal(assessDirection(model,direction).brier,e.test.directional[direction].brier);}
 assert.equal(decide(dataset.bars,model,{fresh:false}).side,'HOLD');
 const bad=structuredClone(model);bad.directionalExperts.UP.source='other';assert.equal(modelForDirection(bad,'UP'),null);assert.equal(assessDirection(bad,'UP').passed,false);
 const entry={side:'BUY',confidence:{percent:75},confidenceGate:{candidateClass:'UP',candidatePercent:75,passed:true}};
 assert.equal(applyModelAssessment(entry,bad).side,'HOLD');
 assert.equal(modelForDirection({...model,expertSelection:undefined},'UP').algorithm,model.algorithm);
});
