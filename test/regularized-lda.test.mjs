import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRegularizedLDA,predictRegularizedLDA,validLinearDiscriminant} from '../src/regularized-lda.mjs';
import {auditProbabilityRows} from '../src/probability-audit.mjs';
const labels=['UP','DOWN','FLAT'],scaler={mean:[0,0],scale:[1,1]},centers=[[1,0],[-1,0],[0,1]],offsets=[[-Math.sqrt(3),-Math.sqrt(3)],[Math.sqrt(3),Math.sqrt(3)],[-1,1],[1,-1]];
const rows=labels.flatMap((label,k)=>offsets.map(o=>({label,features:o.map((x,j)=>x+centers[k][j])})));
test('LDA probabilities match the independent shared-covariance Gaussian formula',()=>{
  const m=fitRegularizedLDA(rows,scaler,{shrinkage:.5,ridge:.1});assert.ok(validLinearDiscriminant(m,2));
  const point=[.3,-.2],v=2.1,c=.5,det=v*v-c*c;
  const density=centers.map(mean=>{const x=point[0]-mean[0],y=point[1]-mean[1];return Math.exp(-.5*(v*x*x-2*c*x*y+v*y*y)/det);});
  const expected=density.map(x=>x/density.reduce((a,b)=>a+b,0)),p=predictRegularizedLDA(point,m,scaler);
  p.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-12));
  assert.ok(Math.abs(m.covariance[0][0]-2.1)<1e-12);assert.ok(Math.abs(m.covariance[0][1]-.5)<1e-12);
});
test('LDA handles singular correlated features but rejects altered factors and malformed inputs',()=>{
  const same=rows.map(r=>({...r,features:[r.features[0],r.features[0]]})),m=fitRegularizedLDA(same,scaler,{shrinkage:0});
  assert.ok(predictRegularizedLDA([0,0],m,scaler).every(Number.isFinite));
  const bad=structuredClone(m);bad.cholesky[0][0]*=2;assert.equal(predictRegularizedLDA([0,0],bad,scaler),null);
  assert.equal(fitRegularizedLDA(rows.filter(r=>r.label!=='UP'),scaler),null);
  for(const t of [0,-1,NaN,Infinity])assert.equal(predictRegularizedLDA([0,0],m,scaler,{temperature:t}),null);
  const before=structuredClone(rows);fitRegularizedLDA(rows,scaler);assert.deepEqual(rows,before);
});
test('probability audit scores nonoverlapping outcomes and chronological sections without inventing trades',()=>{
  const start=Date.UTC(2026,0,1),r=Array.from({length:12},(_,i)=>({index:i,labelEndIndex:i+4,label:i<6?'UP':'DOWN',time:new Date(start+i*900000).toISOString(),labelEndTime:new Date(start+(i+4)*900000).toISOString(),probabilities:[.8,.1,.1]}));
  const before=structuredClone(r),a=auditProbabilityRows(r,[1/3,1/3,1/3]);
  assert.equal(a.nonOverlapping.sample,3);assert.equal(a.nonOverlapping.independenceAssumed,false);
  assert.deepEqual(a.segments.map(x=>x.sample),[4,4,4]);assert.ok(a.segments[0].brier<a.segments[2].brier);
  assert.equal(a.nonOverlapping.directionalAbove60.observedFrequency,2/3);assert.equal(a.nonOverlapping.directionalAbove60.kind,'market-direction-not-trade-win-rate');assert.deepEqual(r,before);
  r[2].index=1;assert.equal(auditProbabilityRows(r,[1/3,1/3,1/3]).status,'unavailable');
  assert.equal(auditProbabilityRows([], [.2,.2,.2]).status,'unavailable');
});
