import test from 'node:test';
import assert from 'node:assert/strict';
import {stationaryIndices,pathSummary,pathRisk} from '../public/core/path-risk.mjs';
test('stationary sampler restarts, advances and wraps exactly as the pinned upstream rule',()=>{
 assert.deepEqual(stationaryIndices([3,2,1,0],[.8,.9,.9,.1],.5),[3,0,1,0]);
 assert.deepEqual(stationaryIndices([3,2,1,0],[.8,.5,.51,.1],.5),[3,2,3,0]);
 assert.deepEqual(stationaryIndices([3,2,1,0],[.8,.9,.9,.1],1),[3,2,1,0]);
 assert.throws(()=>stationaryIndices([4],[.1],.5));
 assert.throws(()=>stationaryIndices([0],[1],.5));
});
test('compounding, peak drawdown and loss streak match independent arithmetic',()=>{
 const r=pathSummary([2,-1,-1,0,2],1);
 assert.ok(Math.abs(r.returnPercent-(1.02*.99*.99*1.02-1)*100)<1e-10);
 assert.ok(Math.abs(r.maxDrawdownPercent-1.99)<1e-10);assert.equal(r.maxLosingStreak,2);assert.equal(r.totalR,2);
 assert.equal(pathSummary([-200,1],1).maxDrawdownPercent,100);assert.equal(pathSummary([-200,1],1).ruined,true);
});
test('constant returns have exact stationary path outcomes; simulations never change confidence',()=>{
 const gains=pathRisk(Array(20).fill(1),{riskPercent:1});
 for(const x of gains.returnPercent)assert.ok(Math.abs(x-(1.01**20-1)*100)<1e-10);
 assert.deepEqual(gains.maxDrawdownPercent,[0,0,0]);assert.deepEqual(gains.maxLosingStreak,[0,0,0]);assert.equal(gains.negativePathFraction,0);
 const losses=pathRisk(Array(20).fill(-1),{riskPercent:1});assert.deepEqual(losses.maxLosingStreak,[20,20,20]);assert.equal(losses.negativePathFraction,1);assert.equal(losses.forecast,false);assert.equal(losses.confidenceUnchanged,true);
});
test('deterministic resampling, ordered quantiles, short histories and bounded inputs',()=>{
 const values=Array.from({length:80},(_,i)=>i%5<3?-1:1.8),r=pathRisk(values);
 assert.deepEqual(r,pathRisk(values));assert.notDeepEqual(r,pathRisk(values,{seed:2}));
 for(const q of [r.returnPercent,r.maxDrawdownPercent,r.maxLosingStreak])assert.ok(q[0]<=q[1]&&q[1]<=q[2]);
 assert.equal(pathRisk([1]).status,'insufficient');
 for(const options of [{iterations:1},{meanBlock:0},{riskPercent:2},{seed:NaN}])assert.throws(()=>pathRisk(values,options));
 assert.throws(()=>pathRisk([NaN]));assert.throws(()=>pathRisk(Array(10001).fill(0)));
});
