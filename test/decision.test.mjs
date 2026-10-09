import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeStrategy,calibrateDecision,decide,aggregateH1,higherTimeframe,labelOutcome,classificationSamples,predictMarketClass,classes,featureNames,decisionVersion} from '../src/decision.mjs';
import {signal,strategies} from '../src/engine.mjs';
import {fitRegularizedQDA} from '../src/regularized-qda.mjs';
import {fitNeuralNetwork,predictNeuralNetwork} from '../src/neural-network.mjs';
import {fitRegularizedLDA,predictRegularizedLDA} from '../src/regularized-lda.mjs';
const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url)));
const model=calibrateDecision(dataset);

test('LDA parameters fit train only; calibration selects the variant and separate test exposes stability',()=>{
  const samples=classificationSamples(dataset.bars),train=samples.filter(r=>r.index<model.split.train.end&&r.labelEndIndex<model.split.train.end),calibration=samples.filter(r=>r.index>=model.split.calibration.start&&r.labelEndIndex<model.split.calibration.end);
  const candidates=model.selection.candidates.filter(c=>c.algorithm==='regularized-lda');assert.equal(candidates.length,2);
  for(const c of candidates){
    const fitted=fitRegularizedLDA(train,model.scaler,{shrinkage:c.shrinkage});
    const brier=calibration.reduce((sum,r)=>sum+predictRegularizedLDA(r.features,fitted,model.scaler,{temperature:c.temperature}).reduce((s,p,k)=>s+(p-(classes[k]===r.label?1:0))**2,0),0)/calibration.length;
    assert.ok(Math.abs(c.brier-brier)<1e-12);
    if(c===candidates.reduce((a,b)=>a.brier<b.brier?a:b))assert.deepEqual(model.linearDiscriminant,fitted);
  }
  assert.equal(model.test.robustness.doesNotSelectModel,true);assert.equal(model.test.robustness.nonOverlapping.independenceAssumed,false);
  assert.equal(model.test.robustness.segments.reduce((s,r)=>s+r.sample,0),model.test.sample);
});

test('LDA confidence runs the selected covariance and preserves strict publication and data guards',()=>{
  const lda={...structuredClone(model),algorithm:'regularized-lda',temperature:2,calibrated:true},sample=classificationSamples(dataset.bars).at(-1),prefix=dataset.bars.slice(0,sample.index+1);
  const expected=predictRegularizedLDA(sample.features,lda.linearDiscriminant,lda.scaler,{temperature:2}),actual=predictMarketClass(prefix,lda);
  classes.forEach((label,k)=>assert.equal(actual[label],expected[k]));
  const d=decide(prefix,lda);assert.equal(d.confidence.algorithm,'regularized-lda');assert.ok(d.side==='HOLD'||d.confidence.percent>60);
  assert.equal(decide(prefix,lda,{fresh:false}).confidence.percent,null);assert.equal(predictMarketClass(prefix,{...lda,linearDiscriminant:null}),null);
  const broken=structuredClone(lda);broken.linearDiscriminant.classPrior=[.1,.1,.8];assert.equal(predictMarketClass(prefix,broken),null);assert.equal(decide(prefix,broken).side,'HOLD');
});
test('decision chooses exactly one regime rule and exposes a separate three-class probability',()=>{
  const decision=decide(dataset.bars,model);
  assert.ok(['BUY','SELL','HOLD'].includes(decision.side));
  assert.equal(decision.strategy,routeStrategy(dataset.bars,model.router).strategy);
  assert.equal(decision.confidence.kind,'market_class_probability');
  assert.ok(!('votes' in decision));
});

function candles(values,start=Date.UTC(2026,0,1)){return values.map((close,i)=>({time:new Date(start+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(values[i-1]??close,close)+1,low:Math.min(values[i-1]??close,close)-1,close,volume:100}));}
function fixedProbabilityModel(p=[.2,.2,.6]){return {...structuredClone(model),algorithm:undefined,version:decisionVersion,classes:[...classes],featureWindow:160,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:p.map(value=>[Math.log(value),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}};}

test('actionable BUY and SELL require published model confidence strictly above 60 percent',()=>{
  const buy=candles([...Array(60).fill(100),104]);buy.at(-1).volume=200;
  const sell=buy.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  for(const [bars,side,index] of [[buy,'BUY',0],[sell,'SELL',1]]){
    for(const [probability,allowed] of [[.07,false],[.599,false],[.6,false],[.6004,false],[.601,true],[.8,true]]){
      const probabilities=[(1-probability)/2,(1-probability)/2,(1-probability)/2];probabilities[index]=probability;
      const d=decide(bars,fixedProbabilityModel(probabilities));
      assert.equal(d.side,allowed?side:'HOLD',side+' at '+probability);
      assert.equal(d.filteredByConfidence,!allowed);assert.equal(d.confidenceGate.passed,allowed);
      assert.equal(d.confidenceGate.candidateSide,side);assert.equal(d.confidenceGate.minimumPercent,60);
      assert.equal(d.confidenceGate.candidatePercent,Math.round(probability*1000)/10);
      assert.equal(d.setup.confirmed,allowed);
      if(allowed){assert.ok(d.confidence.percent>60);assert.ok(d.entry>0);}
      else{assert.equal(d.entry,null);assert.equal(d.stop,null);assert.equal(d.target,null);assert.equal(d.confidence.class,'FLAT');assert.match(d.reason,/60/);}
    }
    for(const unavailable of [null,{...fixedProbabilityModel(),version:'unknown'},{...fixedProbabilityModel(),calibratedThrough:'2099-01-01T00:00:00Z'}]){
      const d=decide(bars,unavailable);assert.equal(d.side,'HOLD');assert.equal(d.confidence.percent,null);assert.equal(d.confidenceGate.candidatePercent,null);assert.equal(d.setup.confirmed,false);
    }
  }
});

test('HOLD confidence is a genuine FLAT class, independently normalized with UP and DOWN',()=>{
  const bars=candles(Array(80).fill(100)),decision=decide(bars,fixedProbabilityModel());
  assert.equal(decision.side,'HOLD');assert.equal(decision.confidence.class,'FLAT');assert.equal(decision.confidence.percent,60);
  assert.ok(Math.abs(Object.values(decision.confidence.classProbs).reduce((a,b)=>a+b)-1)<1e-12);
  assert.notEqual(decision.confidence.percent,100*(1-Math.max(decision.confidence.classProbs.UP,decision.confidence.classProbs.DOWN)));
  assert.notEqual(decision.confidence.percent,decision.score);
});

test('BUY and SELL percentages use their respective market class and never the criteria score',()=>{
  const buy=candles([...Array(60).fill(100),104]);buy.at(-1).volume=200;
  const sell=buy.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  for(const [bars,side,percent,marketClass,probabilities] of [[buy,'BUY',80,'UP',[.8,.1,.1]],[sell,'SELL',75,'DOWN',[.1,.75,.15]]]){const d=decide(bars,fixedProbabilityModel(probabilities));assert.equal(d.side,side);assert.equal(d.score,100);assert.equal(d.confidence.percent,percent);assert.equal(d.confidence.class,marketClass);}
});

test('routing does not fall back to another active strategy or consult votes',()=>{
  let example=null;
  for(let i=60;i<dataset.bars.length;i++){
    const bars=dataset.bars.slice(0,i+1),route=routeStrategy(bars);
    if(signal(bars,route.strategy).side==='HOLD'&&strategies.some(s=>s.id!==route.strategy&&signal(bars,s.id).side!=='HOLD')){example=bars;break;}
  }
  assert.ok(example,'fixture must contain a routed HOLD despite another active rule');
  const d=decide(example);assert.equal(d.side,'HOLD');assert.equal(d.strategy,routeStrategy(example).strategy);assert.equal(d.confidence.percent,null);
});

test('H1 bars require four real consecutive aligned closed candles',()=>{
  const bars=candles([100,101,102,103,104,105,106,107]);
  const hours=aggregateH1(bars);assert.equal(hours.length,2);assert.equal(hours[0].open,100);assert.equal(hours[0].close,103);assert.equal(hours[0].volume,400);assert.equal(hours[0].endTime,'2026-01-01T01:00:00.000Z');
  assert.equal(aggregateH1(bars.filter((_,i)=>i!==1)).length,1);
  assert.equal(aggregateH1(bars.map((b,i)=>i===3?{...b,closed:false}:b)).length,1);
  assert.equal(aggregateH1(candles([100,101,102,103],Date.UTC(2026,0,1,0,45))).length,0);
  const acrossNight=[...bars.slice(0,2),...candles([100,101],Date.UTC(2026,0,2,0,30))];assert.equal(aggregateH1(acrossNight).length,0);
});

test('H1 filter rejects the selected rule’s opposing direction and documents insufficient-hour fallback',()=>{
  const bars=candles(Array.from({length:240},(_,i)=>100+i*.02));
  // The new 00:00 candle is closed, but its UTC hour is still incomplete.
  const previous=bars.at(-1).close;bars.push({time:new Date(Date.UTC(2026,0,1)+240*900000).toISOString(),open:previous,high:previous+.1,low:previous-3.1,close:previous-3,volume:200});
  const route=routeStrategy(bars);assert.equal(route.strategy,'donchian55');assert.equal(route.higherTimeframe.direction,'UP');assert.equal(signal(bars,route.strategy).side,'SELL');
  const d=decide(bars,fixedProbabilityModel());assert.equal(d.side,'HOLD');assert.equal(d.filteredByH1,true);assert.match(d.reason,/H1/);
  assert.equal(d.setup.confirmed,false);assert.equal(d.setup.entry,null);
  const fallback=higherTimeframe(bars.slice(0,60));assert.equal(fallback.available,false);assert.equal(fallback.status,'insufficient');assert.match(fallback.why,/21/);
  const stale=[...bars.slice(0,240),{...bars.at(-1),time:'2026-01-05T00:00:00Z'}];assert.equal(higherTimeframe(stale).status,'stale');
});

test('compression without a closed break never selects squeeze and trending continuation does not require a fresh cross',()=>{
  const compress=candles([...Array.from({length:60},(_,i)=>100+(i%2?1:-1)),...Array.from({length:20},(_,i)=>100+(i%2?.05:-.05))]);
  const q=signal(compress,'squeeze');assert.equal(q.side,'HOLD');assert.notEqual(routeStrategy(compress).strategy,'squeeze');
  const trend=candles([...Array(60).fill(100),100.1,100.3,100.2,100.4,100.3,100.5,100.4,100.6,100.5,100.7,100.6,100.8,100.7,100.9,100.8,101,100.9,101.1,101,101.2,101.4]);
  // Narrow real candle bodies retain directional close position on this fixture.
  for(const b of trend){b.high=Math.max(b.open,b.close)+.1;b.low=Math.min(b.open,b.close)-.1;}
  assert.equal(signal(trend,'ema-cross').side,'HOLD');const route=routeStrategy(trend);assert.notEqual(route.strategy,'ema-cross');assert.notEqual(route.strategy,'macd');assert.equal(decide(trend,fixedProbabilityModel([.8,.1,.1])).side,'BUY');
});

test('routed rule and structural levels depend only on the closed prefix across the expanded router',()=>{
  for(let i=120;i<300;i+=29){const prefix=dataset.bars.slice(0,i),tail=dataset.bars.slice(i).map(b=>({...b,open:b.open*3,high:b.high*3,low:b.low*3,close:b.close*3}));assert.deepEqual(decide([...prefix,...tail].slice(0,i)),decide(prefix));}
});

test('market labels apply the ATR neutral band and explicit round-trip costs at exactly one hour',()=>{
  const bars=candles(Array(64).fill(100));bars.at(-1).close=100.8;bars.at(-1).high=102;
  const withoutCost=labelOutcome(bars,59,{cost:{feeBps:0,slippageBps:0}}),withCost=labelOutcome(bars,59,{cost:{feeBps:5,slippageBps:5}});
  assert.equal(withoutCost.label,'UP');assert.equal(withCost.label,'FLAT');assert.ok(Math.abs(withoutCost.neutralBand-.007)<1e-12);assert.ok(Math.abs(withCost.neutralBand-.009)<1e-12);assert.equal(withCost.roundTripCost,.002);
  const down=structuredClone(bars);down.at(-1).close=98;down.at(-1).low=97;assert.equal(labelOutcome(down,59,{cost:{feeBps:0,slippageBps:0}}).label,'DOWN');
  assert.equal(Date.parse(withCost.labelEndTime)-(Date.parse(bars[59].time)+900000),3600000);
  const missing=structuredClone(bars);for(let i=61;i<missing.length;i++)missing[i].time=new Date(Date.parse(missing[i].time)+86400000).toISOString();assert.equal(labelOutcome(missing,59),null);
});

test('chronological partitions purge forward labels and never cross missing periods',()=>{
  const rows=classificationSamples(dataset.bars),s=model.split;
  const train=rows.filter(r=>r.index<s.train.end&&r.labelEndIndex<s.train.end),calibration=rows.filter(r=>r.index>=s.calibration.start&&r.labelEndIndex<s.calibration.end),testRows=rows.filter(r=>r.index>=s.test.start);
  assert.equal(train.length,model.trainingRange.sample);assert.equal(calibration.length,model.calibrationRange.sample);assert.equal(testRows.length,model.testRange.sample);
  assert.equal(s.calibration.start-s.train.end,4);assert.equal(s.test.start-s.calibration.end,4);
  assert.ok(train.every(r=>r.labelEndIndex<s.train.end));assert.ok(calibration.every(r=>r.labelEndIndex<s.calibration.end));
  assert.ok(rows.every(r=>Date.parse(r.labelEndTime)-(Date.parse(r.time)+900000)===3600000));
});

test('final test prices cannot change learned weights, standardization, temperature or routing thresholds',()=>{
  const changed=structuredClone(dataset);
  for(let i=model.split.calibration.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.1+(i%5)*.01;
  const second=calibrateDecision(changed);
  for(const key of ['weights','scaler','temperature','router','classPrior','training','calibration','discriminant'])assert.deepEqual(second[key],model[key],key);
  assert.notDeepEqual(second.test,model.test);
});

test('calibration changes never refit the train-only weights or standardizer',()=>{
  const changed=structuredClone(dataset);
  for(let i=model.split.train.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.05+(i%4)*.003;
  const second=calibrateDecision(changed);
  for(const key of ['weights','scaler','router','classPrior'])assert.deepEqual(second[key],model[key],key);
});

test('model reports all class samples, frozen holdout scoring and finite probability diagnostics',()=>{
  assert.equal(model.status,'estimate');assert.equal(model.calibrated,model.algorithm!=='weighted-knn');assert.equal(model.calibrationMethod,model.algorithm==='weighted-knn'?'neighbor-count-validation':'temperature-scaling');assert.equal(model.audited,true);
  for(const split of ['training','calibration','test']){
    const report=model[split];assert.ok(report.sample>0);assert.equal(Object.values(report.classSamples).reduce((sum,n)=>sum+n,0),report.sample);assert.ok(report.brier>=0&&report.brier<=2);assert.ok(Number.isFinite(report.logLoss));assert.ok(Number.isFinite(report.baselineBrier));assert.ok(Number.isFinite(report.brierSkill));
    for(const label of classes)assert.equal(report.reliability[label].reduce((sum,bin)=>sum+bin.n,0),report.sample);
  }
  const p=predictMarketClass(dataset.bars,model);assert.ok(classes.every(label=>p[label]>=0&&p[label]<=1));assert.ok(Math.abs(Object.values(p).reduce((sum,x)=>sum+x,0)-1)<1e-12);
  assert.deepEqual(calibrateDecision(dataset),model);
});

test('one classifier is selected by calibration Brier among five families and eleven independent variants',()=>{
  assert.equal(decisionVersion,'regime-classifier-v5');
  assert.ok(['multinomial-logistic','weighted-knn','regularized-qda','neural-network','regularized-lda'].includes(model.algorithm));
  assert.equal(model.selection.metric,'brier');assert.equal(model.selection.partition,'calibration');
  assert.equal(model.selection.holdoutUsed,false);assert.equal(model.selection.trainingRefit,false);
  assert.deepEqual(model.selection.candidates.map(candidate=>[candidate.algorithm,candidate.k,candidate.shrinkage,candidate.hiddenUnits]),[['multinomial-logistic',null,null,null],['weighted-knn',15,null,null],['weighted-knn',31,null,null],['weighted-knn',61,null,null],['regularized-qda',null,.25,null],['regularized-qda',null,.5,null],['regularized-qda',null,.9,null],['neural-network',null,null,8],['neural-network',null,null,16],['regularized-lda',null,.25,null],['regularized-lda',null,.9,null]]);
  const best=model.selection.candidates.reduce((winner,candidate)=>candidate.brier<winner.brier?candidate:winner);
  assert.equal(model.algorithm,best.algorithm);assert.equal(model.selection.selectedK,best.k);assert.equal(model.selection.selectedShrinkage,best.shrinkage);assert.equal(model.selection.selectedHiddenUnits,best.hiddenUnits);
  assert.equal(model.calibration.brier,best.brier);
  assert.ok(model.neighbors.samples.every(sample=>sample.index<model.split.train.end&&sample.labelEndIndex<model.split.train.end));
  assert.equal(model.neighbors.samples.length,model.trainingRange.sample);
  assert.equal(model.training.predictionMode,model.algorithm==='weighted-knn'?'leave-one-out':'resubstitution');
});

test('changing the holdout cannot select another classifier or neighbor count',()=>{
  const changed=structuredClone(dataset);
  for(let i=model.split.calibration.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.2+(i%7)*.02;
  const second=calibrateDecision(changed);
  for(const key of ['algorithm','selection','neighbors','weights','scaler','temperature','calibration','discriminant','neural','linearDiscriminant'])assert.deepEqual(second[key],model[key],key);
  assert.notDeepEqual(second.test,model.test);
});

test('calibration cannot enter the stored neighbors, refit their scaler or change logistic weights',()=>{
  const changed=structuredClone(dataset);
  for(let i=model.split.train.end;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.08+(i%3)*.005;
  const second=calibrateDecision(changed);
  for(const key of ['neighbors','weights','scaler','classPrior','router'])assert.deepEqual(second[key],model[key],key);
  const train=classificationSamples(dataset.bars).filter(row=>row.index<model.split.train.end&&row.labelEndIndex<model.split.train.end);
  assert.deepEqual(second.discriminant,fitRegularizedQDA(train,model.scaler,{shrinkage:second.discriminant.shrinkage}));
  assert.deepEqual(second.neural,fitNeuralNetwork(train,model.scaler,{hiddenUnits:second.neural.hiddenUnits,iterations:160,regularization:.01}));
});

test('neural variants fit train only and choose temperature using calibration only',()=>{
  const samples=classificationSamples(dataset.bars),train=samples.filter(row=>row.index<model.split.train.end&&row.labelEndIndex<model.split.train.end),calibration=samples.filter(row=>row.index>=model.split.calibration.start&&row.labelEndIndex<model.split.calibration.end);
  const candidates=model.selection.candidates.filter(row=>row.algorithm==='neural-network');assert.equal(candidates.length,2);
  for(const candidate of candidates){
    const neural=fitNeuralNetwork(train,model.scaler,{hiddenUnits:candidate.hiddenUnits,iterations:160,regularization:.01});
    assert.equal(neural.trainingSamples,model.trainingRange.sample);assert.ok(neural.iterations<=160);
    const loss=temperature=>calibration.reduce((sum,row)=>sum-Math.log(Math.max(predictNeuralNetwork(row.features,neural,model.scaler,{temperature})[classes.indexOf(row.label)],1e-15)),0)/calibration.length;
    let temperature=1,bestLoss=loss(1);
    for(let i=0;i<=40;i++){const next=Math.exp(Math.log(.25)+i*Math.log(16)/40),nextLoss=loss(next);if(nextLoss<bestLoss){bestLoss=nextLoss;temperature=next;}}
    assert.equal(candidate.temperature,temperature);assert.equal(candidate.logLoss,bestLoss);
    const brier=calibration.reduce((sum,row)=>sum+predictNeuralNetwork(row.features,neural,model.scaler,{temperature}).reduce((total,p,k)=>total+(p-(classes[k]===row.label?1:0))**2,0),0)/calibration.length;
    assert.ok(Math.abs(candidate.brier-brier)<1e-12);
  }
});

test('neural confidence uses the selected weights and temperature while preserving action and freshness guards',()=>{
  const nn={...structuredClone(model),algorithm:'neural-network',temperature:2,calibrated:true},sample=classificationSamples(dataset.bars).at(-1),prefix=dataset.bars.slice(0,sample.index+1);
  const expected=predictNeuralNetwork(sample.features,nn.neural,nn.scaler,{temperature:2}),actual=predictMarketClass(prefix,nn),d=decide(prefix,nn);
  classes.forEach((label,k)=>assert.equal(actual[label],expected[k]));
  assert.equal(d.confidence.algorithm,'neural-network');assert.equal(d.confidence.calibrated,true);assert.equal(d.confidence.neighboursCount,0);assert.deepEqual(d.confidence.neighboursDetail,[]);
  assert.ok(d.side==='HOLD'||d.confidence.percent>60);assert.equal(decide(prefix,nn,{fresh:false}).confidence.percent,null);
  assert.equal(predictMarketClass(prefix,{...nn,neural:null}),null);const broken=structuredClone(nn);broken.neural.hiddenWeights[0][0]=NaN;
  assert.equal(predictMarketClass(prefix,broken),null);assert.equal(decide(prefix,broken).side,'HOLD');assert.equal(decide(prefix,broken).confidence.percent,null);
  const buy=candles([...Array(60).fill(100),104]);buy.at(-1).volume=200;
  const sell=buy.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  for(const [bars,side,k] of [[buy,'BUY',0],[sell,'SELL',1]])for(const probability of [.6,.6004,.601,.8]){
    const fixed={...structuredClone(nn),calibratedThrough:'2025-01-01T00:00:00Z',temperature:1},p=Array(3).fill((1-probability)/2);p[k]=probability;
    fixed.neural.hiddenWeights=fixed.neural.hiddenWeights.map(row=>row.map(()=>0));fixed.neural.hiddenBias.fill(0);fixed.neural.outputWeights=fixed.neural.outputWeights.map(row=>row.map(()=>0));fixed.neural.outputBias=p.map(Math.log);
    const decision=decide(bars,fixed);assert.equal(decision.side,probability>=.601?side:'HOLD');assert.equal(decision.confidenceGate.passed,probability>=.601);
    assert.equal(decide(bars,fixed,{fresh:false}).side,'HOLD');
    const crossed=decide(bars,fixed,{quote:{price:side==='BUY'?1:10000}});assert.equal(crossed.side,'HOLD');assert.equal(crossed.filteredByLevels,true);assert.equal(crossed.entry,null);
  }
});

test('quadratic confidence uses only its selected train covariance and retains all action guards',()=>{
  const qda={...structuredClone(model),algorithm:'regularized-qda',temperature:1,calibrated:true};
  const probabilities=predictMarketClass(dataset.bars,qda),d=decide(dataset.bars,qda);
  assert.ok(classes.every(label=>Number.isFinite(probabilities[label])&&probabilities[label]>=0&&probabilities[label]<=1));
  assert.ok(Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.equal(d.confidence.algorithm,'regularized-qda');assert.equal(d.confidence.calibrated,true);assert.equal(d.confidence.neighboursCount,0);assert.deepEqual(d.confidence.neighboursDetail,[]);
  assert.ok(d.side==='HOLD'||d.confidence.percent>60);
  assert.equal(decide(dataset.bars,qda,{fresh:false}).confidence.percent,null);
  assert.equal(predictMarketClass(dataset.bars,{...qda,discriminant:null}),null);
  const broken=structuredClone(qda);broken.discriminant.classes[0].cholesky[0][0]=0;
  assert.equal(predictMarketClass(dataset.bars,broken),null);assert.equal(decide(dataset.bars,broken).side,'HOLD');assert.equal(decide(dataset.bars,broken).confidence.percent,null);
});

test('knn confidence exposes actual historical neighbors without features and keeps the strict action gate',()=>{
  const knn={...structuredClone(model),algorithm:'weighted-knn',neighbors:{...model.neighbors,k:15},temperature:1};
  const d=decide(dataset.bars,knn);
  assert.equal(d.confidence.algorithm,'weighted-knn');assert.equal(d.confidence.neighboursCount,15);
  assert.equal(d.confidence.neighboursDetail.length,5);
  assert.ok(d.confidence.neighboursDetail.every(row=>classes.includes(row.label)&&Number.isFinite(row.distance)&&Date.parse(row.time)<=Date.parse(model.trainedThrough)&&!('features' in row)));
  assert.ok(d.side==='HOLD'||d.confidence.percent>60);
  assert.equal(predictMarketClass(dataset.bars,{...knn,neighbors:{...knn.neighbors,samples:[]}}),null);
  assert.equal(predictMarketClass(dataset.bars,{...knn,algorithm:'unknown'}),null);
  const logistic=decide(dataset.bars,fixedProbabilityModel());assert.equal(logistic.confidence.algorithm,'multinomial-logistic');assert.equal(logistic.confidence.neighboursCount,0);assert.deepEqual(logistic.confidence.neighboursDetail,[]);
});

test('forming candles cannot change a closed decision or model prediction',()=>{
  const partial={...dataset.bars.at(-1),time:new Date(Date.parse(dataset.bars.at(-1).time)+900000).toISOString(),open:10000,high:20000,low:100,close:15000,closed:false};
  assert.deepEqual(decide([...dataset.bars,partial],model),decide(dataset.bars,model));
  assert.deepEqual(predictMarketClass([...dataset.bars,partial],model),predictMarketClass(dataset.bars,model));
});

test('insufficient classes, future models, stale prices and unknown model versions never yield a fabricated percentage',()=>{
  const flat={symbol:'TEST',timeframe:15,bars:candles(Array(800).fill(100))},insufficient=calibrateDecision(flat);
  assert.equal(insufficient.status,'insufficient');assert.equal(insufficient.weights,null);assert.equal(insufficient.algorithm,null);assert.equal(insufficient.selection,null);assert.equal(decide(flat.bars,insufficient).confidence.percent,null);
  assert.equal(decide(dataset.bars.slice(0,model.split.train.end),model).confidence.percent,null);
  const stale=decide(dataset.bars,model,{fresh:false,dataMode:'historical'});assert.equal(stale.side,'HOLD');assert.equal(stale.confidence.percent,null);assert.equal(stale.confidence.status,'stale');assert.equal(stale.dataMode,'historical');
  assert.equal(predictMarketClass(dataset.bars,{...model,version:'future-v99'}),null);assert.equal(predictMarketClass(dataset.bars,{...model,weights:[[NaN]]}),null);
  assert.equal(decide([],null).side,'HOLD');assert.equal(decide([],null).confidence.percent,null);
});
