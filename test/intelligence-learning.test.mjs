import test from 'node:test';
import assert from 'node:assert/strict';
import {fitResearchClassifier,predictResearchClassifier,fitRegimeOutcomeModel,predictRegimeOutcome,probabilityMetrics} from '../src/intelligence-learning.mjs';
test('research logistic learns a separable training relation without mutating inputs',()=>{
 const rows=Array.from({length:100},(_,i)=>({features:[i<50?-1:1,7],y:i<50?0:1})),copy=structuredClone(rows),model=fitResearchClassifier(rows);
 assert.ok(predictResearchClassifier([-1,7],model)<.2);assert.ok(predictResearchClassifier([1,7],model)>.8);
 assert.deepEqual(rows,copy);assert.equal(model.scaler.mean[1],7);assert.equal(model.scaler.scale[1],1);
 assert.deepEqual(JSON.parse(JSON.stringify(model)),model);
 assert.equal(predictResearchClassifier([1,7],{status:'insufficient'}),null);
 assert.throws(()=>predictResearchClassifier([NaN,7],model));
});
test('one-class training abstains; malformed labels and hyperparameters fail',()=>{
 assert.equal(fitResearchClassifier(Array.from({length:20},()=>({features:[1],y:1}))).status,'insufficient');
 assert.throws(()=>fitResearchClassifier([{features:[1],y:2}]));
 assert.throws(()=>fitResearchClassifier([{features:[1],y:0}],{l2:-1}));
});
test('strategy/regime rates shrink toward training prior with an analytic oracle',()=>{
 const rows=[...Array.from({length:10},()=>({strategy:'a',regime:0,y:1})),...Array.from({length:10},()=>({strategy:'b',regime:1,y:0}))],model=fitRegimeOutcomeModel(rows);
 assert.equal(predictRegimeOutcome('a',0,model),.75);assert.equal(predictRegimeOutcome('b',1,model),.25);assert.equal(predictRegimeOutcome('unseen',0,model),.5);
});
test('probability metrics reproduce hand-computed Brier and log loss',()=>{
 const m=probabilityMetrics([{y:0},{y:1}],[.25,.75]);assert.equal(m.brier,.0625);assert.ok(Math.abs(m.logLoss+Math.log(.75))<1e-12);assert.equal(m.ece,.25);
 assert.equal(probabilityMetrics([],[]).status,'insufficient');assert.throws(()=>probabilityMetrics([{y:1}],[1.1]));
 assert.ok(Number.isFinite(probabilityMetrics([{y:0}],[1]).logLoss));
});
