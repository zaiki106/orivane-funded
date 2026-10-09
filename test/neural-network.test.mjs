import test from 'node:test';
import assert from 'node:assert/strict';
import {fitNeuralNetwork,predictNeuralNetwork,validNeuralModel,neuralAlgorithm} from '../src/neural-network.mjs';

const labels=['UP','DOWN','FLAT'],identity={mean:[0,0],scale:[1,1]};
const points=[[-1,-1,'UP'],[1,1,'UP'],[-1,1,'DOWN'],[1,-1,'DOWN'],[0,0,'FLAT']];
const rows=points.flatMap(([x,y,label])=>Array.from({length:12},(_,i)=>({features:[x+(i%3-1)*.015,y+(Math.floor(i/3)%3-1)*.015],label})));

test('a genuine hidden layer learns opposite XOR corners and the central third class',()=>{
  const model=fitNeuralNetwork(rows,identity,{hiddenUnits:8,iterations:160,regularization:.001});
  assert.equal(model.algorithm,neuralAlgorithm);assert.equal(validNeuralModel(model,2),true);
  for(const [x,y,label] of points){
    const p=predictNeuralNetwork([x,y],model,identity),k=labels.indexOf(label);
    assert.equal(p.indexOf(Math.max(...p)),k,`${x}, ${y}`);assert.ok(p[k]>.85,`${label}: ${p[k]}`);
    assert.ok(Math.abs(p.reduce((a,b)=>a+b)-1)<1e-12);
  }
});

test('forward probabilities match independently calculated tanh and softmax with scaled clipped inputs',()=>{
  const fitted=fitNeuralNetwork(rows,identity,{hiddenUnits:2,iterations:1});
  const model={...fitted,hiddenWeights:[[.2,-.4],[-.3,.1]],hiddenBias:[.1,-.2],outputWeights:[[.8,-.7],[-.6,.4],[.2,.3]],outputBias:[.2,-.1,.05]};
  const scaler={mean:[2,-1],scale:[2,.5]},features=[100,-.8],temperature=2;
  // Standardized x is clipped to 5; y is exactly 0.4.
  const hidden=[Math.tanh(.2*5-.4*.4+.1),Math.tanh(-.3*5+.1*.4-.2)];
  const logits=[(.8*hidden[0]-.7*hidden[1]+.2)/2,(-.6*hidden[0]+.4*hidden[1]-.1)/2,(.2*hidden[0]+.3*hidden[1]+.05)/2];
  const values=logits.map(Math.exp),sum=values.reduce((a,b)=>a+b),actual=predictNeuralNetwork(features,model,scaler,{temperature});
  actual.forEach((p,k)=>assert.ok(Math.abs(p-values[k]/sum)<1e-12));
  assert.deepEqual(actual,predictNeuralNetwork([12,-.8],model,scaler,{temperature}));
  const warm=predictNeuralNetwork(features,model,scaler,{temperature:8});assert.ok(Math.max(...warm)<Math.max(...actual));
});

test('seeded training is deterministic, bounded and independent of caller mutations',()=>{
  const input=structuredClone(rows),scaler=structuredClone(identity),options={hiddenUnits:16,iterations:80};
  const first=fitNeuralNetwork(input,scaler,options),second=fitNeuralNetwork(input,scaler,options);
  assert.deepEqual(first,second);assert.equal(first.iterations,80);assert.equal(first.trainingSamples,input.length);
  assert.equal(first.initialization,'seeded-xavier-uniform');assert.equal(first.optimizer,'full-batch-adam');assert.equal(first.activation,'tanh');assert.equal(first.outputActivation,'softmax');
  assert.deepEqual(first.classPrior,[.4,.4,.2]);
  const copy=structuredClone(first);input[0].features[0]=999;input[0].label='FLAT';scaler.mean[0]=999;
  assert.deepEqual(first,copy);assert.ok(!('samples' in first));assert.ok(!('features' in first));
  assert.notDeepEqual(fitNeuralNetwork(rows,identity,{...options,seed:42}).hiddenWeights,first.hiddenWeights);
  assert.equal(fitNeuralNetwork(rows,identity,{iterations:501}),null);
});

test('one Adam update matches an independent cross-entropy gradient calculation',()=>{
  const seed=777,hiddenUnits=1,rate=.01,regularization=.02;
  const trained=fitNeuralNetwork(rows,identity,{hiddenUnits,iterations:1,seed,learningRate:rate,regularization});
  // Independent Mulberry32 + Xavier initialization supplies the pre-update weights.
  let state=seed>>>0;const random=()=>{let t=state+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  const w1=[(2*random()-1)*Math.sqrt(6/3),(2*random()-1)*Math.sqrt(6/3)],w2=Array.from({length:3},()=>(2*random()-1)*Math.sqrt(6/4)),bias=trained.classPrior.map(Math.log);
  const gradW1=[0,0],gradW2=[0,0,0],gradB2=[0,0,0];let gradB1=0;
  for(const row of rows){
    const h=Math.tanh(w1[0]*row.features[0]+w1[1]*row.features[1]),scores=w2.map((w,k)=>Math.exp(w*h+bias[k])),total=scores.reduce((a,b)=>a+b);
    const errors=scores.map((value,k)=>value/total-(row.label===labels[k]?1:0));
    const delta=errors.reduce((sum,error,k)=>sum+error*w2[k],0)*(1-h*h);
    for(let j=0;j<2;j++)gradW1[j]+=delta*row.features[j];gradB1+=delta;
    for(let k=0;k<3;k++){gradW2[k]+=errors[k]*h;gradB2[k]+=errors[k];}
  }
  const update=(weight,gradient,penalty=0)=>{const g=gradient/rows.length+penalty*weight;return weight-rate*g/(Math.abs(g)+1e-8);};
  for(let j=0;j<2;j++)assert.ok(Math.abs(trained.hiddenWeights[0][j]-update(w1[j],gradW1[j],regularization))<1e-12);
  assert.ok(Math.abs(trained.hiddenBias[0]-update(0,gradB1))<1e-12);
  for(let k=0;k<3;k++){
    assert.ok(Math.abs(trained.outputWeights[k][0]-update(w2[k],gradW2[k],regularization))<1e-12);
    assert.ok(Math.abs(trained.outputBias[k]-update(bias[k],gradB2[k]))<1e-12);
  }
});

test('malformed input, training configuration and network state fail closed',()=>{
  const model=fitNeuralNetwork(rows,identity);
  for(const invalid of [null,{...model,algorithm:'unknown'},{...model,dimension:3},{...model,hiddenUnits:0},{...model,activation:'relu'}])assert.equal(predictNeuralNetwork([1,0],invalid,identity),null);
  for(const mutate of [copy=>copy.hiddenWeights[0][0]=NaN,copy=>copy.hiddenBias[0]=Infinity,copy=>copy.outputWeights.pop(),copy=>copy.outputBias[0]=NaN,copy=>copy.classPrior=[1,0,0]]){
    const invalid=structuredClone(model);mutate(invalid);assert.equal(predictNeuralNetwork([1,0],invalid,identity),null);
  }
  for(const point of [[NaN,0],[1],[Infinity,0]])assert.equal(predictNeuralNetwork(point,model,identity),null);
  assert.equal(predictNeuralNetwork([1,0],model,{...identity,scale:[1,0]}),null);assert.equal(predictNeuralNetwork([1,0],model,identity,{temperature:0}),null);
  assert.equal(fitNeuralNetwork(rows.filter(row=>row.label!=='FLAT'),identity),null);assert.equal(fitNeuralNetwork([...rows,{label:'UP',features:[NaN,0]}],identity),null);
  for(const options of [{hiddenUnits:0},{hiddenUnits:65},{iterations:0},{regularization:-1},{seed:NaN},{learningRate:0}])assert.equal(fitNeuralNetwork(rows,identity,options),null);
});
