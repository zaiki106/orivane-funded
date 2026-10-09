import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRegularizedQDA,predictRegularizedQDA,validDiscriminantModel,qdaAlgorithm} from '../src/regularized-qda.mjs';

const labels=['UP','DOWN','FLAT'],identity={mean:[0,0],scale:[1,1]};
// Each class has the same independent offsets. Their population covariance is
// exactly [[2, 1], [1, 2]], before off-diagonal shrinkage and positive ridge.
const offsets=[[-Math.sqrt(3),-Math.sqrt(3)],[Math.sqrt(3),Math.sqrt(3)],[-1,1],[1,-1]];
const centers=[[1,0],[-1,0],[0,1]],rows=labels.flatMap((label,k)=>offsets.map(offset=>({label,features:offset.map((value,j)=>value+centers[k][j])})));

test('QDA probabilities match an independent analytical bivariate Gaussian calculation',()=>{
  const model=fitRegularizedQDA(rows,identity,{shrinkage:.5,ridge:.1});
  assert.equal(model.algorithm,qdaAlgorithm);assert.equal(validDiscriminantModel(model,2),true);
  const point=[.3,-.2],variance=2.1,covariance=.5,determinant=variance**2-covariance**2;
  const densities=centers.map(center=>{const x=point[0]-center[0],y=point[1]-center[1];return Math.exp(-.5*(variance*x*x-2*covariance*x*y+variance*y*y)/determinant)/(2*Math.PI*Math.sqrt(determinant));});
  const expected=densities.map(value=>value/densities.reduce((a,b)=>a+b,0)),actual=predictRegularizedQDA(point,model,identity);
  for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-12,`${labels[i]}: ${actual[i]} vs ${expected[i]}`);
  assert.ok(Math.abs(actual.reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.ok(Math.abs(model.classes[0].covariance[0][1]-.5)<1e-12);
  assert.ok(Math.abs(model.classes[0].covariance[0][0]-2.1)<1e-12);
});

test('positive ridge supports singular and constant features without fabricated fallback probabilities',()=>{
  const singular=labels.flatMap((label,k)=>Array.from({length:8},(_,i)=>({label,features:[k+i/10,k+i/10,7,0]}))),scaler={mean:[0,0,7,0],scale:[1,1,1,1]};
  for(const shrinkage of [.25,.5,.9]){
    const model=fitRegularizedQDA(singular,scaler,{shrinkage});
    assert.equal(validDiscriminantModel(model,4),true);
    const p=predictRegularizedQDA([1,1,7,0],model,scaler);
    assert.ok(p.every(value=>Number.isFinite(value)&&value>=0&&value<=1));assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-12);
  }
  const constants=labels.flatMap(label=>Array.from({length:5},()=>({label,features:[2,2]})));
  assert.deepEqual(predictRegularizedQDA([2,2],fitRegularizedQDA(constants,identity),identity),[1/3,1/3,1/3]);
});

test('class-specific covariance separates equal centers through quadratic rather than linear boundaries',()=>{
  const radii=[.1,2,1],sameCenter=labels.flatMap((label,k)=>[[radii[k],0],[-radii[k],0],[0,radii[k]],[0,-radii[k]]].map(features=>({label,features}))),model=fitRegularizedQDA(sameCenter,identity,{shrinkage:.5});
  assert.ok(model.classes.every(group=>group.mean.every(value=>value===0)));
  const near=predictRegularizedQDA([0,0],model,identity),far=predictRegularizedQDA([3,0],model,identity);
  assert.equal(near.indexOf(Math.max(...near)),0);assert.equal(far.indexOf(Math.max(...far)),1);
  const densities=radii.map(radius=>{const variance=radius**2/2+.001;return Math.exp(-9/(2*variance))/variance;}),total=densities.reduce((a,b)=>a+b,0);
  for(let k=0;k<3;k++)assert.ok(Math.abs(far[k]-densities[k]/total)<1e-12);
});

test('temperature preserves class ranking, while a warmer model approaches the equal prior',()=>{
  const model=fitRegularizedQDA(rows,identity),cold=predictRegularizedQDA([1,0],model,identity,{temperature:1}),warm=predictRegularizedQDA([1,0],model,identity,{temperature:4});
  assert.equal(cold.indexOf(Math.max(...cold)),warm.indexOf(Math.max(...warm)));assert.ok(Math.max(...warm)<Math.max(...cold));
  assert.equal(predictRegularizedQDA([1,0],model,identity,{temperature:0}),null);
});

test('QDA consumes only supplied training observations and uses their empirical class priors',()=>{
  const extra=[...rows,...rows.filter(row=>row.label==='FLAT')],model=fitRegularizedQDA(extra,identity);
  assert.deepEqual(model.classPrior,[.25,.25,.5]);assert.deepEqual(model.classes.map(group=>group.count),[4,4,8]);
  const copied=structuredClone(model);extra[0].features[0]=999;assert.deepEqual(model,copied);
  assert.equal(fitRegularizedQDA(rows.filter(row=>row.label!=='FLAT'),identity),null);
  assert.equal(fitRegularizedQDA(rows,identity,{ridge:0}),null);assert.equal(fitRegularizedQDA(rows,identity,{shrinkage:1.1}),null);
});

test('malformed models, dimensions and nonfinite observations fail closed',()=>{
  const model=fitRegularizedQDA(rows,identity);
  for(const invalid of [null,{...model,algorithm:'unknown'},{...model,classPrior:[0,0,1]},{...model,dimension:3}])assert.equal(predictRegularizedQDA([1,0],invalid,identity),null);
  for(const mutate of [copy=>copy.classes[0].cholesky[0][0]=0,copy=>copy.classes[0].mean[0]=NaN,copy=>copy.classes[0].logDeterminant=Infinity,copy=>copy.classes[0].cholesky[0][1]=1,copy=>copy.classes[0].covariance[0][1]=NaN]){
    const invalid=structuredClone(model);mutate(invalid);assert.equal(predictRegularizedQDA([1,0],invalid,identity),null);
  }
  assert.equal(predictRegularizedQDA([NaN,0],model,identity),null);assert.equal(predictRegularizedQDA([1],model,identity),null);
  assert.equal(predictRegularizedQDA([1,0],model,{...identity,scale:[1,0]}),null);
  assert.equal(fitRegularizedQDA([...rows,{label:'UP',features:[NaN,0]}],identity),null);
});
