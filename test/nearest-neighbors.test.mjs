import test from 'node:test';
import assert from 'node:assert/strict';
import {fitNearestNeighbors,predictNearestNeighbors,neighborPolicy} from '../src/nearest-neighbors.mjs';

const scaler={mean:[0,0],scale:[1,1]};
const rows=[];
for(const [x,y,label] of [[-1,-1,'UP'],[1,1,'UP'],[-1,1,'DOWN'],[1,-1,'DOWN'],[0,0,'FLAT']]){
  for(let i=0;i<20;i++)rows.push({features:[x+(i%5-2)*.01,y+(Math.floor(i/5)-1.5)*.01],label,index:rows.length,time:new Date(Date.UTC(2025,0,1)+rows.length*900000).toISOString()});
}

test('nonlinear neighbors recover opposite XOR corners and the central neutral cluster',()=>{
  const model=fitNearestNeighbors(rows,scaler,{k:15});
  for(const [features,index] of [[[-1,-1],0],[[1,1],0],[[-1,1],1],[[1,-1],1],[[0,0],2]]){
    const prediction=predictNearestNeighbors(features,model,scaler);
    assert.ok(prediction.probabilities[index]>.85);
    assert.ok(Math.abs(prediction.probabilities.reduce((a,b)=>a+b)-1)<1e-12);
    assert.equal(prediction.neighborsCount,15);assert.equal(prediction.detail.length,5);
  }
  assert.equal(model.distance,neighborPolicy.distance);assert.equal(model.weighting,'1/(1+distance)');assert.equal(model.smoothing,3);
});

test('distance weighting and prior smoothing match an independent three-observation calculation',()=>{
  const points=[{features:[0],label:'UP'},{features:[1],label:'DOWN'},{features:[2],label:'FLAT'}],unit={mean:[0],scale:[1]};
  const model=fitNearestNeighbors(points,unit,{k:3}),p=predictNearestNeighbors([0],model,unit);
  const weights=[1,.5,1/3],total=weights.reduce((a,b)=>a+b);
  for(let i=0;i<3;i++)assert.ok(Math.abs(p.probabilities[i]-(3*weights[i]/total+1)/6)<1e-12);
  assert.deepEqual(p.detail.map(row=>row.distance),[0,1,2]);
  assert.ok(p.effectiveNeighbors>2&&p.effectiveNeighbors<3);
});

test('training diagnostics exclude their own observation and ties remain deterministic',()=>{
  const model=fitNearestNeighbors(rows,scaler,{k:15}),first=predictNearestNeighbors(rows[0].features,model,scaler,{excludeIndex:0});
  assert.ok(first.detail.every(row=>row.time!==rows[0].time));
  assert.deepEqual(predictNearestNeighbors([0,0],model,scaler),predictNearestNeighbors([0,0],structuredClone(model),scaler));
});

test('stored training samples are copied and invalid or insufficient data yields no estimate',()=>{
  const input=structuredClone(rows),model=fitNearestNeighbors(input,scaler,{k:15}),before=predictNearestNeighbors([1,1],model,scaler);
  input[0].features[0]=10000;input[0].label='DOWN';assert.deepEqual(predictNearestNeighbors([1,1],model,scaler),before);
  assert.equal(fitNearestNeighbors([],scaler,{k:15}),null);
  assert.equal(fitNearestNeighbors(rows.slice(0,20),scaler,{k:15}),null);
  assert.equal(fitNearestNeighbors(rows,{mean:[0,0],scale:[0,1]},{k:15}),null);
  assert.equal(predictNearestNeighbors([NaN,0],model,scaler),null);
  assert.equal(predictNearestNeighbors([1,1],{...model,samples:[]},scaler),null);
});
