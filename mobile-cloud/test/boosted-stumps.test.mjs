import test from 'node:test';import assert from 'node:assert/strict';
import {fitBoostedStumps,predictBoostedStumps,validBoostedModel} from '../public/core/boosted-stumps.mjs';
const rows=Array.from({length:180},(_,i)=>({features:[(i-90)/90],label:i<60?'DOWN':i<120?'FLAT':'UP'})),scaler={mean:[0],scale:[1]};
test('boosted stumps learn a known nonlinear three-region event without a probability floor',()=>{
 const m=fitBoostedStumps(rows,scaler);assert.ok(validBoostedModel(m,1));
 for(const [x,k] of [[-.8,1],[0,2],[.8,0]]){const p=predictBoostedStumps([x],m,scaler);assert.ok(p[k]>.6);assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-12);}
 assert.deepEqual(fitBoostedStumps(rows,scaler),m);
});
test('invalid data, shapes, parameters and serialized trees fail closed',()=>{
 const m=fitBoostedStumps(rows,scaler);
 assert.equal(fitBoostedStumps(rows.filter(r=>r.label!=='UP'),scaler),null);
 for(const options of [{rounds:0},{rounds:100},{learningRate:NaN},{minLeaf:1},{l2:0}])assert.equal(fitBoostedStumps(rows,scaler,options),null);
 assert.equal(predictBoostedStumps([NaN],m,scaler),null);assert.equal(predictBoostedStumps([0],m,scaler,{temperature:0}),null);
 const bad=structuredClone(m);bad.trees[0].feature=99;assert.equal(predictBoostedStumps([0],bad,scaler),null);
});
