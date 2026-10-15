import test from 'node:test';
import assert from 'node:assert/strict';
import {fitResearchClassifier,predictResearchClassifier} from '../src/intelligence-learning.mjs';

const training=()=>Array.from({length:20},(_,i)=>({features:[i%2?1:-1],y:i%2}));

test('research predictor rejects sparse feature and coefficient arrays instead of assuming missing values',()=>{
 const model=fitResearchClassifier(training());
 assert.throws(()=>predictResearchClassifier(Array(1),model));
 assert.throws(()=>predictResearchClassifier([1],{...model,weights:Array(1)}));
});

test('research predictor refuses finite-input logit overflow instead of returning NaN',()=>{
 const trained=fitResearchClassifier(training());
 const model={...trained,dimension:2,weights:[1e308,1e308],scaler:{mean:[0,0],scale:[.01,.01]}};
 assert.throws(()=>predictResearchClassifier([1,-1],model));
});

test('every accepted classifier hyperparameter combination yields a finite fitted artifact or explicit abstention',()=>{
 const model=fitResearchClassifier(training(),{l2:100,learningRate:1,iterations:1000});
 assert.ok(model.status==='fitted'||model.status==='insufficient');
 if(model.status==='fitted'){
  assert.ok(model.weights.every(Number.isFinite));assert.ok(Number.isFinite(model.intercept));
  const prediction=predictResearchClassifier([1],model);
  assert.ok(Number.isFinite(prediction)&&prediction>=0&&prediction<=1);
  assert.deepEqual(JSON.parse(JSON.stringify(model)),model);
 }
});
