import test from 'node:test';
import assert from 'node:assert/strict';
import {extendTradeFeatures} from '../src/trade-features-v2.mjs';
import {tradeFeatureNames,tradeFeatureNamesV2,collectTradeExamples,liveTradeCandidate} from '../src/trade-confidence.mjs';

const t=Date.UTC(2026,0,1),cost={feeBps:0,slippageBps:0};
const bars=Array.from({length:180},(_,i)=>{const close=100+i*.07+Math.sin(i*.35)*.25,open=100+(i-1)*.07+Math.sin((i-1)*.35)*.25;return {time:new Date(t+i*900000).toISOString(),open,close,high:Math.max(open,close)+.06,low:Math.min(open,close)-.06,volume:100+i%7,closed:true};});
test('v2 distinguishes strategy, side-aligned context and UTC session without outcomes',()=>{
 const x=tradeFeatureNames.map(()=>0);x[0]=2;x[19]=-1;
 const y=extendTradeFeatures(x,'pullback',t);
 assert.equal(y.length,116);assert.deepEqual(y.slice(0,34),x);
 assert.equal(y[tradeFeatureNamesV2.indexOf('sideAligned:0')],-2);
 assert.equal(y[tradeFeatureNamesV2.indexOf('utcHourSin')],0);
 assert.equal(y[tradeFeatureNamesV2.indexOf('utcHourCos')],1);
 assert.equal(y[tradeFeatureNamesV2.indexOf('strategy:pullback')],1);
 assert.equal(y[tradeFeatureNamesV2.indexOf('strategy:breakout')],0);
 assert.equal(extendTradeFeatures(x,'unknown',t),null);
 assert.equal(extendTradeFeatures(x,'pullback',t+1),null);
});
test('migration is identical to causal export and does not change labels or plans',()=>{
 const data={symbol:'BTC/USD',source:'Controlled test fixture',timeframe:15,bars};
 const old=collectTradeExamples(data,{cost}),next=collectTradeExamples(data,{cost,featureVersion:'v2'});
 assert.ok(next.examples.length>10);assert.deepEqual(next.features,tradeFeatureNamesV2);
 assert.equal(old.examples.length,next.examples.length);
 for(let i=0;i<old.examples.length;i++){
  const a=old.examples[i],b=next.examples[i];
  assert.deepEqual(b.features,extendTradeFeatures(a.features,a.strategy,a.entryTimeMs));
  assert.deepEqual({...b,features:a.features},a);
 }
});
test('browser computes the v2 model vector; research predictions cannot authorize a trade',()=>{
 const names=tradeFeatureNamesV2,model={schemaVersion:'trade-tp-before-sl-v1',kind:'tp_before_sl_probability',outcomeVersion:'trade-barriers-v1',symbol:'BTC/USD',source:'Controlled test fixture',trainedThroughMs:t-900000,featureNames:names,maxBars:16,strategyMode:'routed',h1Policy:'align-if-available',registryVersion:'orivane-strategy-registry-v1',entryPolicy:'next-closed-bar-boundary-v1',maxEntryDelayMs:60000,cost,algorithm:'logistic',predictor:{weights:names.map(()=>0),intercept:1,mean:names.map(()=>0),scale:names.map(()=>1)},calibration:{method:'platt',a:1,b:0},publication:{passed:false,status:'observation'}};
 const decision=liveTradeCandidate(bars,{symbol:model.symbol,source:model.source,cost,asOf:t+180*900000,quote:{price:bars.at(-1).close},fresh:true,executable:true,model});
 assert.equal(decision.tradeFeatures.length,116);assert.equal(decision.confidence.percent,73.1);
 assert.equal(decision.side,'HOLD');assert.equal(decision.confidenceGate.passed,false);
 assert.equal(decision.modelAssessment.reason,'unpublished-trade-model');
});
