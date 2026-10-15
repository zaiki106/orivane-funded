import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRegimes,inferRegime,distributionDrift,calibratePredictionSets,predictionSet,adaptiveEnsemble} from '../src/intelligence-ai.mjs';

const close=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const clone=value=>JSON.parse(JSON.stringify(value));

test('deterministic standardized regimes recover independently known two-cloud centers',()=>{
 const rows=[[-11,8],[-10,8],[-9,8],[9,8],[10,8],[11,8]],original=clone(rows);
 const model=fitRegimes(rows,{clusters:2});
 assert.equal(model.status,'fitted');assert.equal(model.converged,true);
 assert.deepEqual(model.counts,[3,3]);close(model.scaler.mean[0],0);close(model.scaler.mean[1],8);
 close(model.scaler.scale[0],Math.sqrt(604/6));assert.equal(model.scaler.scale[1],1);
 const centers=model.centroids.map(row=>row[0]*model.scaler.scale[0]+model.scaler.mean[0]).sort((a,b)=>a-b);
 close(centers[0],-10);close(centers[1],10);
 assert.equal(inferRegime([-10,8],model).regime,inferRegime([-9,8],model).regime);
 assert.notEqual(inferRegime([-10,8],model).regime,inferRegime([10,8],model).regime);
 assert.deepEqual(fitRegimes(rows,{clusters:2}),model);assert.deepEqual(rows,original);
 assert.ok(Object.isFrozen(model));assert.ok(Object.isFrozen(model.centroids[0]));
 assert.throws(()=>{model.centroids[0][0]=999;},TypeError);
 assert.deepEqual(inferRegime([10,8],JSON.parse(JSON.stringify(model))),inferRegime([10,8],model));
});

test('regime inference cannot refit a training scaler or centroids on future features',()=>{
 const model=fitRegimes([[-2],[-1.9],[-1.8],[2],[2.1],[2.2]],{clusters:2}),before=clone(model);
 const features=[10000],copy=features.slice();inferRegime(features,model);
 assert.deepEqual(model,before);assert.deepEqual(features,copy);
 assert.throws(()=>inferRegime([1,2],model),TypeError);
 assert.throws(()=>inferRegime([1],{...before,scaler:{mean:[0],scale:[0]}}),TypeError);
 assert.throws(()=>inferRegime([1],{...before,centroids:Array(2)}),TypeError);
});

test('empty, constant and insufficient distinct regime training fail explicitly',()=>{
 assert.equal(fitRegimes([]).status,'insufficient');
 assert.equal(fitRegimes(Array.from({length:20},()=>[4,4])).reason,'constant_features');
 const twoPoints=Array.from({length:20},(_,i)=>[i%2]);
 assert.equal(fitRegimes(twoPoints,{clusters:3}).reason,'too_few_distinct_training_points');
 assert.equal(inferRegime([1],fitRegimes([])).status,'insufficient');
 assert.throws(()=>fitRegimes([[0],[1],[2],[3],[4],[5]],{clusters:1}),RangeError);
});

test('regime scaling avoids overflow for large finite opposite-sign data',()=>{
 const model=fitRegimes([[-1e300],[-9e299],[-8e299],[8e299],[9e299],[1e300]],{clusters:2});
 assert.equal(model.status,'fitted');assert.ok(Number.isFinite(model.inertia));
 assert.equal(inferRegime([1e300],model).status,'estimated');
});

test('PSI is zero for identical windows and reference cuts cannot use current observations',()=>{
 const reference=Array.from({length:40},(_,i)=>[i,100]),current=clone(reference),before=clone(reference);
 const identity=distributionDrift(reference,current,{bins:4});
 assert.equal(identity.status,'measured');close(identity.meanPsi,0);close(identity.maxPsi,0);
 const shifted=distributionDrift(reference,current.map(row=>[row[0]+1000,200]),{bins:4});
 assert.deepEqual(shifted.features.map(row=>row.boundaries),identity.features.map(row=>row.boundaries));
 assert.ok(shifted.features.every(row=>row.psi>0));assert.deepEqual(reference,before);assert.deepEqual(current,before);
});

test('constant-reference PSI detects out-of-range shift using independent smoothing oracle',()=>{
 const reference=Array.from({length:20},()=>[5]),current=Array.from({length:20},()=>[6]);
 const result=distributionDrift(reference,current);
 assert.deepEqual(result.features[0].referenceCounts,[0,20,0]);assert.deepEqual(result.features[0].currentCounts,[0,0,20]);
 const low=.5/21.5,high=20.5/21.5;
 close(result.features[0].psi,2*(high-low)*Math.log(high/low));
 assert.deepEqual(result.features[0].boundaries,[5]);
 assert.equal(distributionDrift(reference,current.slice(0,19)).status,'insufficient');
 assert.throws(()=>distributionDrift(reference,current.map(()=>[1,2])),TypeError);
});

test('split conformal uses ceil((n+1)(1-alpha)) order statistic, never interpolates',()=>{
 const rows=Array.from({length:20},(_,i)=>({probability:(i+1)/20,y:0,timeMs:i+1})),copy=clone(rows);
 const calibration=calibratePredictionSets(rows,{alpha:.1});
 assert.equal(calibration.status,'calibrated');assert.equal(calibration.rank,19);close(calibration.quantile,.95);
 assert.equal(calibration.calibratedThroughMs,20);assert.match(calibration.coverageCaveat,/dependent market time series/);
 assert.deepEqual(predictionSet(.5,calibration).labels,[0,1]);
 assert.deepEqual(predictionSet(.99,calibration).labels,[1]);
 assert.deepEqual(predictionSet([.99,.01],calibration).labels,[0]);
 assert.deepEqual(rows,copy);assert.ok(Object.isFrozen(calibration));
});

test('conformal sets support empty sets and include exact boundary scores',()=>{
 const rows=Array.from({length:20},(_,i)=>({probability:.1,y:0,timeMs:i}));
 const calibration=calibratePredictionSets(rows);
 assert.deepEqual(predictionSet(.5,calibration).labels,[]);
 assert.deepEqual(predictionSet(.1,calibration).labels,[0]);
 assert.deepEqual(predictionSet(.95,calibration).labels,[1]);
});

test('conformal insufficient samples or unachievable rank never fabricate coverage',()=>{
 const rows=Array.from({length:20},(_,i)=>({probability:.5,y:i%2,timeMs:i}));
 assert.equal(calibratePredictionSets(rows.slice(0,19)).status,'insufficient');
 const impossible=calibratePredictionSets(rows,{alpha:.001});
 assert.equal(impossible.rank,21);assert.equal(impossible.status,'insufficient');assert.equal(impossible.quantile,null);
 assert.deepEqual(predictionSet(.999,impossible).labels,[0,1]);
 assert.equal(predictionSet(.999,impossible).status,'insufficient');
 assert.throws(()=>predictionSet([.1,.2],calibratePredictionSets(rows)),TypeError);
 assert.throws(()=>predictionSet(.5,{...calibratePredictionSets(rows),rank:1}),TypeError);
});

function history(){return Array.from({length:5},(_,i)=>[
 {model:'accurate',probability:.8,y:1,labelEndTimeMs:i+1},
 {model:'weak',probability:.4,y:1,labelEndTimeMs:i+1}]).flat();}

test('adaptive inverse-Brier weights match analytic losses and sum to one',()=>{
 const result=adaptiveEnsemble(history(),{asOf:6});
 assert.equal(result.status,'weighted');close(result.weights.accurate,.9);close(result.weights.weak,.1);
 close(result.models.find(row=>row.model==='accurate').brier,.04);close(result.models.find(row=>row.model==='weak').brier,.36);
 close(Object.values(result.weights).reduce((a,b)=>a+b,0),1);
 assert.ok(Object.isFrozen(result.weights));
});

test('label ends at or after asOf never influence adaptive weights',()=>{
 const completed=history(),pending=[{model:'accurate',probability:0,y:1,labelEndTimeMs:6},
  {model:'weak',probability:1,y:0,labelEndTimeMs:10000}],before=clone([...completed,...pending]);
 const baseline=adaptiveEnsemble(completed,{asOf:6}),withFuture=adaptiveEnsemble([...completed,...pending],{asOf:6});
 assert.deepEqual(withFuture.weights,baseline.weights);assert.deepEqual(withFuture.models,baseline.models);assert.equal(withFuture.excluded,2);
 const changed=pending.map(row=>({...row,y:1-row.y,probability:1-row.probability}));
 assert.deepEqual(adaptiveEnsemble([...completed,...changed],{asOf:6}),withFuture);
 assert.deepEqual([...completed,...pending],before);
});

test('recency is based on sorted distinct completed timestamps, not input order',()=>{
 const rows=Array.from({length:5},(_,i)=>[
  {model:'a',probability:i===4?1:0,y:1,labelEndTimeMs:i+1},
  {model:'b',probability:.5,y:1,labelEndTimeMs:i+1}]).flat();
 const result=adaptiveEnsemble(rows,{asOf:10,halfLife:1});
 // oldest-to-newest weights 1/16,1/8,1/4,1/2,1; a's latest loss=0.
 close(result.models.find(row=>row.model==='a').brier,15/31);
 close(result.models.find(row=>row.model==='b').brier,.25);
 assert.deepEqual(adaptiveEnsemble(rows.toReversed(),{asOf:10,halfLife:1}),result);
});

test('zero Brier is floored, sparse evidence is identified, and model names are safe keys',()=>{
 const rows=history().map(row=>({...row,model:row.model==='accurate'?'__proto__':row.model,probability:row.model==='accurate'?1:.5}));
 const result=adaptiveEnsemble(rows,{asOf:6});close(result.weights.__proto__,25/26);close(result.weights.weak,1/26);
 assert.equal(Object.getPrototypeOf(result.weights),Object.prototype);
 assert.equal(adaptiveEnsemble(history().slice(0,8),{asOf:6}).status,'insufficient');
 assert.equal(adaptiveEnsemble([],{asOf:6}).status,'insufficient');
});

test('all public diagnostics reject malformed numeric data and invalid controls',()=>{
 for(const rows of [[[1],[NaN]],[[1],[Infinity]],[[1],['2']],[[1],[1,2]],[Array(129).fill(0)],Array.from({length:50001},()=>[1])])assert.throws(()=>fitRegimes(rows),TypeError);
 assert.throws(()=>distributionDrift([[0]],[[0]],{bins:1}),RangeError);
 assert.throws(()=>calibratePredictionSets([{probability:.5,y:2,timeMs:1}]),TypeError);
 assert.throws(()=>calibratePredictionSets([{probability:.5,y:1,timeMs:NaN}]),TypeError);
 assert.throws(()=>calibratePredictionSets([],{alpha:1}),RangeError);
 assert.throws(()=>adaptiveEnsemble(history()),TypeError);
 assert.throws(()=>adaptiveEnsemble(history(),{asOf:10,halfLife:0}),RangeError);
 assert.throws(()=>adaptiveEnsemble([{model:'x',probability:2,y:0,labelEndTimeMs:1}],{asOf:10}),TypeError);
 assert.throws(()=>fitRegimes(Array.from({length:6},()=>Array(1))),TypeError);
 assert.throws(()=>predictionSet(Array(2),calibratePredictionSets([])),TypeError);
 assert.throws(()=>inferRegime(Array(1),fitRegimes([])),TypeError);
});
