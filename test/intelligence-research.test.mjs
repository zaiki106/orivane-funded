import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchDataset,collectIntelligenceExamples,partitionIntelligenceRows,researchIntelligence,auditPublishedResearch} from '../src/intelligence-research.mjs';
import {analyzeIntelligenceContext,signalFromIntelligenceContext,intelligenceStrategies} from '../src/intelligence-strategies.mjs';
import {makeTradePlan,labelTradeOutcome,tradeEntryPolicy} from '../src/trade-outcome.mjs';
import {strategies as existingStrategies} from '../src/engine.mjs';

// Deliberately artificial deterministic fixtures exercise code paths only.
// Their outcomes, fitted models and scores are never market evidence.
const start=Date.parse('2024-01-01T00:00:00Z'),interval=900_000;
const cost={feeBps:1,slippageBps:1,assumption:true};
function dataset(length=320,{flat=false}={}) {
  const price=i=>flat?1000:1000+20*Math.sin(i*2*Math.PI/80)+3*Math.sin(i*.71);
  return {symbol:'BTC/USD',source:'DETERMINISTIC SYNTHETIC TEST FIXTURE — NOT MARKET EVIDENCE',timeframe:15,synthetic:true,
    provenance:{syntheticTestOnly:true},bars:Array.from({length},(_,i)=>{const close=price(i),open=i?price(i-1):close;return {time:new Date(start+i*interval).toISOString(),open,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,close,volume:100+i%17,closed:true};})};
}
const settings=data=>({asOf:start+data.bars.length*interval,cost});
let evaluatedFixture;
function evaluated() {return evaluatedFixture??=(researchIntelligence(dataset(2400),settings(dataset(2400))));}

test('cost stress freezes setup selection and reproduces the independent base test summaries',()=>{
 const report=evaluated();assert.equal(report.costStress.selectionFrozen,true);assert.equal(report.costStress.levelsFrozen,true);assert.equal(report.costStress.reroutesAfterInvalidation,false);
 assert.deepEqual(report.costStress.scenarios.map(s=>s.multiplier),[1,1.5,2]);
 for(const scenario of report.costStress.scenarios){assert.equal(scenario.referenceSetups,report.partitions.counts.test);assert.equal(scenario.cost.feeBps,cost.feeBps*scenario.multiplier);assert.equal(scenario.cost.slippageBps,cost.slippageBps*scenario.multiplier);}
 assert.deepEqual(report.costStress.scenarios[0].strategies,report.strategies);
 for(const stressed of report.costStress.scenarios.slice(1))for(const strategy of stressed.strategies){const base=report.strategies.find(s=>s.id===strategy.id);if(strategy.n===base.n&&strategy.n>0)assert.ok(strategy.totalR<=base.totalR+1e-10);}
});

test('source validation excludes explicitly forming bars but rejects unmarked future and malformed bars',()=>{
  const data=dataset(),options=settings(data),expected=validateResearchDataset(data,options);
  const forming={time:'not a timestamp',open:NaN,closed:false};assert.deepEqual(validateResearchDataset({...data,bars:[...data.bars,forming]},options),expected);
  assert.throws(()=>validateResearchDataset({...data,bars:[...data.bars,{...data.bars.at(-1),time:new Date(options.asOf).toISOString()}]},options),/future|incomplete/);
  assert.throws(()=>validateResearchDataset({...data,bars:[...data.bars,{...data.bars.at(-1),time:'invalid'}]},options),/Invalid/);
  for(const mutate of [
    copy=>{copy.symbol='BTC/USDT';},copy=>{copy.source=' ';},copy=>{copy.timeframe=60;},
    copy=>{copy.bars[2].time=copy.bars[1].time;},copy=>{copy.bars[2].high=1;},
    copy=>{copy.bars[2].volume=-1;},copy=>{copy.bars[2].time='2024-01-01T00:30:00';},
  ]){const copy=structuredClone(data);mutate(copy);assert.throws(()=>validateResearchDataset(copy,options));}
  assert.throws(()=>validateResearchDataset({...data,bars:data.bars.slice(1)},options),/320/);
});

test('example labels reproduce the shared execution and 16-bar outcome contract including costs',()=>{
  const data=dataset(640),options=settings(data),before=structuredClone(data),result=collectIntelligenceExamples(data,options);
  assert.ok(result.rows.length>=20,'fixture must generate actual completed setups');
  assert.ok(result.rows.some(row=>row.side==='BUY'));assert.ok(result.rows.some(row=>row.side==='SELL'));
  const previousEnd=new Map();
  for(const row of result.rows){
    const index=(row.entryTimeMs-start)/interval,history=data.bars.slice(Math.max(0,index-240),index);
    const context=analyzeIntelligenceContext(history,{nowMs:row.entryTimeMs}),raw=signalFromIntelligenceContext(context,row.strategy);
    assert.notEqual(raw.side,'HOLD');assert.equal(row.side,raw.side);
    const plan=makeTradePlan(raw,{price:data.bars[index].open},cost,{entryTime:row.entryTimeMs});
    assert.equal(plan.valid,true);assert.equal(plan.stop,raw.stop);assert.equal(plan.target,raw.target);assert.equal(plan.entryPolicy,tradeEntryPolicy);
    assert.equal(plan.maxBars,16);assert.equal(plan.expiryTimeMs,row.entryTimeMs+16*interval);
    const outcome=labelTradeOutcome(plan,data.bars.slice(index,index+16));
    assert.equal(outcome.censored,false);assert.equal(row.y,outcome.y);assert.equal(row.netR,outcome.netR);assert.equal(row.status,outcome.status);assert.equal(row.labelEndTimeMs,outcome.labelEndTimeMs);
    assert.equal(row.baseFeatures.length,10);assert.ok(row.baseFeatures.every(Number.isFinite));
    assert.ok(row.entryTimeMs>(previousEnd.get(row.strategy)??-Infinity),'no overlapping or equal-boundary outcomes per recipe');previousEnd.set(row.strategy,row.labelEndTimeMs);
    assert.ok(row.labelEndTimeMs<=options.asOf,'incomplete future label must not enter examples');
  }
  assert.deepEqual(data,before,'collection must not mutate its source');
  assert.throws(()=>collectIntelligenceExamples(data,{...options,cost:{feeBps:-1,slippageBps:0}}),/costs/);
});

test('changing the entire final half leaves earlier completed examples and feature frames identical',()=>{
  const data=dataset(640),changed=structuredClone(data),cut=start+320*interval;
  for(let i=320;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=1.7;
  const original=collectIntelligenceExamples(data,settings(data)),mutated=collectIntelligenceExamples(changed,settings(changed));
  const earlier=rows=>rows.filter(row=>row.labelEndTimeMs<cut);
  assert.ok(earlier(original.rows).length>10,'lookahead assertion must be nonvacuous');assert.deepEqual(earlier(mutated.rows),earlier(original.rows));
  assert.deepEqual(mutated.frames.filter(row=>row.timeMs<cut),original.frames.filter(row=>row.timeMs<cut));
  assert.notDeepEqual(mutated.frames.filter(row=>row.timeMs>=cut),original.frames.filter(row=>row.timeMs>=cut));
});

test('partitioning purges labels touching cuts and applies the exact 16-bar embargo',()=>{
  const boundaries={trainEndMs:100*interval,selectionEndMs:200*interval,calibrationEndMs:300*interval,testEndMs:400*interval};
  const specs=[['train',90,99],['touch-train',90,100],['at-train',100,101],['before-selection',116-1/interval,120],['selection',116,120],['touch-selection',190,200],['calibration',216,220],['touch-calibration',290,300],['test',316,320],['end-test',390,400],['after-test',390,400+1/interval]];
  const rows=specs.map(([id,entry,end])=>({id,entryTimeMs:Math.round(entry*interval),labelEndTimeMs:Math.round(end*interval)}));
  const parts=partitionIntelligenceRows(rows,boundaries),ids=key=>parts[key].map(row=>row.id);
  assert.deepEqual(ids('train'),['train']);assert.deepEqual(ids('selection'),['selection']);assert.deepEqual(ids('calibration'),['calibration']);assert.deepEqual(ids('test'),['test','end-test']);
  assert.deepEqual(ids('excluded'),['touch-train','at-train','before-selection','touch-selection','touch-calibration','after-test']);
  assert.equal(parts.embargoMs,16*interval);assert.deepEqual(parts.boundaries,boundaries);
  assert.throws(()=>partitionIntelligenceRows(rows,{...boundaries,selectionEndMs:boundaries.trainEndMs}),/boundaries/);
  assert.throws(()=>partitionIntelligenceRows([{entryTimeMs:5,labelEndTimeMs:4}],boundaries),/boundaries/);
});

test('source gaps suppress contexts instead of fabricating candles or feature frames',()=>{
  const data=dataset();for(let i=160;i<data.bars.length;i++)data.bars[i].time=new Date(start+(i+1)*interval).toISOString();
  const options={asOf:start+321*interval,cost};assert.equal(validateResearchDataset(data,options).length,320);
  const result=collectIntelligenceExamples(data,options);assert.ok(result.diagnostics.contextUnavailable>0);
  assert.ok(result.frames.length>0);assert.ok(result.frames.every(frame=>frame.timeMs<start+160*interval));
});

test('insufficient evidence is an explicit reproducible report with no trained probability claims',()=>{
  const data=dataset(320,{flat:true}),options=settings(data),report=researchIntelligence(data,options);
  assert.deepEqual(researchIntelligence(data,options),report);assert.equal(report.status,'insufficient');assert.equal(report.testOnly,true);assert.equal(report.examples,0);assert.deepEqual(report.models,[]);
  assert.equal(report.test,undefined);assert.match(report.reason,/chronological partitions/);assert.ok(report.hypotheses.some(item=>item.id==='insufficient-evidence'));
  assert.equal(report.policy.paperPromotion,false);assert.equal(report.policy.realTradingAuthorized,false);assert.equal(report.policy.selectionUsesTest,false);assert.equal(report.policy.confidenceUnchanged,true);
  assert.ok(report.latestSetups.every(signal=>signal.confidence===null&&signal.researchOnly));
  const forming={...data.bars.at(-1),time:new Date(options.asOf).toISOString(),closed:false};const withForming=researchIntelligence({...data,bars:[...data.bars,forming]},options);
  assert.notEqual(withForming.sourceSha256,report.sourceSha256,'digest identifies the entire submitted source');
  for(const key of ['examples','partitions','regimes','drift','latestSetups'])assert.deepEqual(withForming[key],report[key]);
});

test('deterministic synthetic end-to-end route fits, selects, calibrates and measures without promotion',()=>{
  const report=evaluated();assert.equal(report.status,'evaluated');assert.equal(report.testOnly,true);assert.equal(report.models.length,4);
  assert.ok(report.partitions.counts.train>=40);for(const name of ['selection','calibration','test'])assert.ok(report.partitions.counts[name]>=20);
  assert.equal(report.ensemble.status,'weighted');assert.ok(report.models.some(model=>model.id===report.selectedOnValidation));
  const expected=report.models.slice().sort((a,b)=>a.selection.brier-b.selection.brier||a.id.localeCompare(b.id))[0].id;assert.equal(report.selectedOnValidation,expected);
  assert.equal(report.uncertainty.status,'calibrated');assert.ok(report.uncertainty.calibratedThroughMs<report.partitions.calibrationEndMs);
  assert.equal(report.uncertainty.testSamples,report.partitions.counts.test);assert.ok(report.uncertainty.testCoverage>=0&&report.uncertainty.testCoverage<=1);
  assert.equal(report.test.ensemble.samples,report.partitions.counts.test);assert.equal(report.test.baseline.samples,report.partitions.counts.test);
  assert.equal(report.test.ensembleNetPerformanceIsNotSimulated,true);assert.equal(report.policy.researchOnly,true);assert.equal(report.policy.paperPromotion,false);assert.equal(report.policy.realTradingAuthorized,false);
  for(const model of report.models){assert.equal(model.model.researchOnly,true);assert.ok(model.selection.brier>=0&&model.selection.brier<=1);assert.ok(model.test.brier>=0&&model.test.brier<=1);}
});

test('reserved test mutations cannot change training scales, centroids, classifier parameters or selection',()=>{
  const original=evaluated(),data=dataset(2400),cut=2040;
  for(let i=cut;i<data.bars.length;i++){for(const key of ['open','high','low','close'])data.bars[i][key]*=1.2;data.bars[i].volume*=3;}
  const changed=researchIntelligence(data,settings(data));assert.equal(changed.status,'evaluated');assert.notEqual(changed.sourceSha256,original.sourceSha256);
  assert.deepEqual(changed.regimes,original.regimes);assert.equal(changed.selectedOnValidation,original.selectedOnValidation);assert.deepEqual(changed.ensemble,original.ensemble);
  assert.deepEqual(changed.models.map(model=>({id:model.id,model:model.model,selection:model.selection})),original.models.map(model=>({id:model.id,model:model.model,selection:model.selection})));
  assert.deepEqual(changed.uncertainty.quantile,original.uncertainty.quantile);assert.equal(changed.partitions.counts.train,original.partitions.counts.train);
});

test('published audit counts missing cost evidence honestly and keeps existing research isolated',()=>{
  const source={kind:'independent-strategy-lab',id:'test-only-report',source:'synthetic audit fixture',symbol:'BTC/USD',strategies:72,results:[
    {id:'positive',h1Policy:'align-if-available',stress:[{costMultiplier:1,netExpectancyR:.1}]},
    {id:'negative',h1Policy:'align-if-available',stress:[{costMultiplier:1,netExpectancyR:-.1}]},
    {id:'missing',h1Policy:'align-if-available',stress:[]},
    {id:'other-policy',h1Policy:'context-only',stress:[{costMultiplier:1,netExpectancyR:9}]},
  ]};
  const result=auditPublishedResearch(source,[{symbol:'BTC/USD',algorithm:'fixture',publication:{status:'observation',passed:false,rejectionReasons:['insufficient']}}]);
  assert.deepEqual(result.evidence,{profiles:3,positiveNetProfiles:1,negativeOrZeroNetProfiles:1,missingNetProfiles:1});assert.equal(result.models[0].paperAuthorized,false);assert.equal(result.policy.paperPromotion,false);assert.equal(result.newResearchStrategies.length,6);
  const ids=new Set(existingStrategies.map(strategy=>strategy.id));assert.ok(intelligenceStrategies.every(strategy=>!ids.has(strategy.id)));
  // Related recipes exist already. Distinct identifiers are not evidence of novel methods.
  for(const familyId of ['donchian55','failed-breakout','squeeze','inside-bar','keltner-reentry','efficiency-trend'])assert.ok(ids.has(familyId));
  assert.throws(()=>auditPublishedResearch({kind:'other',results:[]}),/report/);
});
