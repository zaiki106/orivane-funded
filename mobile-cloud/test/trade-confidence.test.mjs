import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyRegistry,getStrategy,registrySummary,strategyDataReady} from '../public/core/strategy-registry.mjs';
import {collectTradeExamples,splitTradeExamples,nonOverlappingTradeRows,assessTradePublication,liveTradeCandidate,tradeFeatureNames} from '../public/core/trade-confidence.mjs';
const t=Date.UTC(2026,0,1),cost={feeBps:0,slippageBps:0},source='Controlled test fixture',symbol='BTC/USD';
function fixture(n=350){return Array.from({length:n},(_,i)=>{const close=100+i*.07+Math.sin(i*.35)*.25,open=100+(i-1)*.07+Math.sin((i-1)*.35)*.25;return {time:new Date(t+i*900000).toISOString(),open,close,high:Math.max(open,close)+.06,low:Math.min(open,close)-.06,volume:100+i%7,closed:true};});}
const dataset={symbol,source,timeframe:15,bars:fixture()},baseModel={schemaVersion:'trade-tp-before-sl-v1',kind:'tp_before_sl_probability',outcomeVersion:'trade-barriers-v1',symbol,source,trainedThrough:new Date(t-900000).toISOString(),featureNames:[...tradeFeatureNames],maxBars:16,strategyMode:'routed',h1Policy:'align-if-available',registryVersion:'orivane-strategy-registry-v1',entryPolicy:'next-closed-bar-boundary-v1',maxEntryDelayMs:60000,cost,algorithm:'logistic',predictor:{weights:tradeFeatureNames.map(()=>0),intercept:1,mean:tradeFeatureNames.map(()=>0),scale:tradeFeatureNames.map(()=>1)},calibration:{method:'platt',a:1,b:0}};
test('all 66 existing rules are documented once and unavailable families remain explicit',()=>{
 assert.equal(strategyRegistry.length,66);assert.equal(new Set(strategyRegistry.map(r=>r.id)).size,66);
 for(const rule of strategyRegistry){assert.equal(rule.status,'research');assert.equal(rule.parameters.expiryBars,16);assert.equal(rule.h1Policy,'align-if-available');assert.ok(rule.conditions.length>10);assert.ok(rule.provenance.sourceModule);}
 assert.equal(getStrategy('ichimoku').warmupBars,78);assert.equal(getStrategy('cmf-breakout').data.volume,'required');assert.equal(getStrategy('missing'),null);
 assert.equal(registrySummary().families.find(f=>f.id==='microstructure').status,'data-required');
 assert.equal(strategyDataReady(getStrategy('cmf-breakout'),fixture().slice(-60).map(b=>({...b,volume:null}))).ready,false);
 const gapped=fixture(78);gapped[0].time=new Date(t-900000).toISOString();assert.equal(strategyDataReady(getStrategy('ichimoku'),gapped).reason,'non-contiguous-history');
});
test('setup-conditioned examples contain no readiness-as-probability or unfinished structures',()=>{
 const exportData=collectTradeExamples(dataset,{cost,strategyMode:'routed'});assert.ok(exportData.examples.length>10);
 assert.equal(exportData.features.length,34);assert.equal(exportData.metadata.maxBars,16);
 assert.equal(exportData.metadata.entryPolicy,'next-closed-bar-boundary-v1');assert.equal(exportData.metadata.maxEntryDelayMs,60000);assert.equal(exportData.metadata.trainingExecution,'next-bar-open-at-boundary');
 for(const row of exportData.examples){assert.ok(['BUY','SELL'].includes(row.side));assert.equal(row.featureTimeMs,row.entryTimeMs);assert.equal(row.features.length,34);assert.equal(row.plan.expiryTimeMs-row.entryTimeMs,16*900000);assert.ok(row.plan.netRisk>0&&row.plan.netReward>0);assert.ok(row.labelEndTimeMs===null||row.labelEndTimeMs>=row.entryTimeMs);assert.equal(row.y===1,row.status==='target');}
});
test('changing future bars cannot alter prior setup features, sides or immutable plans',()=>{
 const original=collectTradeExamples(dataset,{cost}),changed=structuredClone(dataset),cutoff=200;
 for(let i=cutoff;i<changed.bars.length;i++)for(const key of ['open','high','low','close'])changed.bars[i][key]*=2;
 const second=collectTradeExamples(changed,{cost}),project=row=>({id:row.id,features:row.features,plan:row.plan,side:row.side}),before=row=>row.entryTimeMs<Date.parse(dataset.bars[cutoff].time);
 assert.deepEqual(second.examples.filter(before).map(project),original.examples.filter(before).map(project));
 const resolved=row=>row.labelEndTimeMs!==null&&row.labelEndTimeMs<Date.parse(dataset.bars[cutoff].time);
 assert.deepEqual(second.examples.filter(resolved),original.examples.filter(resolved));
});

test('synthetic provider flags propagate into training exports for fixture rejection',()=>{
 const small={...dataset,bars:fixture(65)};
 for(const flags of [{synthetic:true},{provenance:{syntheticTestOnly:true}},{quality:{synthetic:true}}])assert.equal(collectTradeExamples({...small,...flags},{cost}).metadata.synthetic,true);
 assert.equal(collectTradeExamples(small,{cost}).metadata.synthetic,false);
});
test('splits purge actual label overlap and embargo the maximum expiry after each boundary',()=>{
 const row=(i,start,end)=>({id:String(i),symbol,source,features:[1],entryTimeMs:start,labelEndTimeMs:end,y:i%2,censored:false,netR:1});
 const rows=[row(1,1,9),row(2,8,11),row(3,10,11),row(4,12,13),row(5,18,21),row(6,22,25),row(7,28,31)];
 const split=splitTradeExamples(rows,{trainEndMs:10,calibrationEndMs:20,testEndMs:30,embargoMs:2});
 assert.deepEqual(split.train.map(r=>r.id),['1']);assert.deepEqual(split.calibration.map(r=>r.id),['4']);assert.deepEqual(split.test.map(r=>r.id),['6']);assert.equal(split.excluded.purged,4);
});
test('non-overlap counts exclude simultaneous and nested trade candidates for one instrument',()=>{
 const rows=[{id:'a',symbol,source,entryTimeMs:0,labelEndTimeMs:10,y:1},{id:'b',symbol,source,entryTimeMs:1,labelEndTimeMs:3,y:0},{id:'c',symbol,source,entryTimeMs:10,labelEndTimeMs:11,y:1},{id:'d',symbol,source,entryTimeMs:12,labelEndTimeMs:13,y:0}];
 assert.deepEqual(nonOverlappingTradeRows(rows).map(r=>r.id),['a','d']);
});
test('publication recomputes actual test probabilities, Brier advantage and selected net returns',()=>{
 const rows=Array.from({length:250},(_,i)=>({id:String(i),symbol,source,entryTimeMs:t+i*2*900000,labelEndTimeMs:t+(i*2+1)*900000,features:tradeFeatureNames.map(()=>0),y:i%5===0?0:1,netR:i%5===0?-1:1.5,censored:false}));
 const report=assessTradePublication(rows,{model:baseModel,baselineProbability:.5,asOf:t+1000*900000});
 assert.equal(report.nonOverlapping,250);assert.equal(report.positive,200);assert.equal(report.negative,50);assert.equal(report.aboveThreshold,250);assert.ok(report.brier<report.baselineBrier);assert.equal(report.passed,true);assert.ok(report.expectancyInterval[0]>0);
 const negative=assessTradePublication(rows.map(r=>({...r,netR:-1})),{model:baseModel,baselineProbability:.5,asOf:t+1000*900000});assert.equal(negative.passed,false);
 const invalid=assessTradePublication([...rows,{...rows[0],id:'bad',netR:NaN}],{model:baseModel,baselineProbability:.5,asOf:t+1000*900000});assert.equal(invalid.reason,'invalid-test-observation');
});
test('real-time candidates require published target models, exact threshold, fresh executable feed and valid provenance',()=>{
 const bars=fixture(180),asOf=t+180*900000,quote={price:bars.at(-1).close},options={symbol,source,cost,asOf,quote,fresh:true,executable:true};
 const absent=liveTradeCandidate(bars,options);assert.equal(absent.side,'HOLD');assert.equal(absent.confidence.kind,'tp_before_sl_probability');assert.equal(absent.modelAssessment.passed,false);
 assert.equal(absent.modelAssessment.reason,'missing-trade-model');
 const publication={policyVersion:'trade-publication-v1',passed:true,status:'paper',outcomeVersion:'trade-barriers-v1',entryPolicy:baseModel.entryPolicy,maxEntryDelayMs:60000,symbol,source,maxBars:16,cost,nonOverlapping:200,positive:160,negative:40,aboveThreshold:200,brier:.1,baselineBrier:.25,netExpectancy:.3,expectancyInterval:[.1,.5],evaluatedThroughMs:t};
 const model={...baseModel,publication},active=liveTradeCandidate(bars,{...options,model});assert.ok(active.candidateSide);assert.equal(active.confidence.kind,'tp_before_sl_probability');assert.equal(active.side,active.candidateSide);assert.equal(active.modelAssessment.passed,true);
 const research=liveTradeCandidate(bars,{...options,model:{...model,publication:{...publication,status:'observation',passed:false}}});
 assert.equal(research.confidence.status,'observation');assert.equal(research.confidence.probability,active.confidence.probability);assert.ok(research.confidence.percent>60);assert.equal(research.confidenceGate.passed,false);assert.equal(research.modelAssessment.passed,false);assert.equal(research.side,'HOLD');assert.equal(research.entry,null);assert.equal(research.stop,null);assert.equal(research.target,null);
 assert.equal(liveTradeCandidate(bars,{...options,model,fresh:false}).side,'HOLD');assert.equal(liveTradeCandidate(bars,{...options,model,executable:false}).side,'HOLD');assert.equal(liveTradeCandidate(bars,{...options,model,source:'Other'}).side,'HOLD');
 assert.equal(absent.entry,null);assert.equal(absent.stop,null);assert.equal(absent.target,null);assert.match(liveTradeCandidate(bars,{...options,fresh:false}).reason,/périmées/);
 const exactly60={...model,predictor:{...model.predictor,intercept:Math.log(.6/.4)}};
 assert.equal(liveTradeCandidate(bars,{...options,model:exactly60}).side,'HOLD');
 const boundary=liveTradeCandidate(bars,{...options,model,asOf:asOf+45000});
 assert.equal(boundary.side,active.side);assert.equal(boundary.executionPlan.entryTimeMs,asOf);assert.equal(boundary.executionPlan.executionTimeMs,asOf+45000);assert.equal(boundary.executionPlan.expiryTimeMs,asOf+16*900000);
 assert.equal(liveTradeCandidate(bars,{...options,model,asOf:asOf+60000}).side,active.side);
 const late=liveTradeCandidate(bars,{...options,model,asOf:asOf+60001});assert.equal(late.side,'HOLD');assert.equal(late.reason,'expired-entry-window');assert.equal(late.confidence.probability,null);assert.equal(late.executionPlan,null);
 const old={...model};delete old.entryPolicy;delete old.maxEntryDelayMs;
 const legacy=liveTradeCandidate(bars,{...options,model:old});assert.equal(legacy.side,'HOLD');assert.equal(legacy.confidence.status,'observation');assert.equal(legacy.confidence.percent,active.confidence.percent);assert.equal(legacy.modelAssessment.reason,'model-entry-policy-mismatch');
 const shifted=bars.map(bar=>({...bar,time:new Date(Date.parse(bar.time)+1).toISOString()}));assert.match(liveTradeCandidate(shifted,{...options,asOf:asOf+1,model}).reason,/invalides/);assert.throws(()=>collectTradeExamples({...dataset,bars:shifted},{cost}));
});
