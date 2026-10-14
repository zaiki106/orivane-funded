import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictTradeProbability,predictTradeMargin,validateTradeModel,passesTradeConfidence,confidenceFromProbability,validateTradePublication} from '../src/trade-inference.mjs';
const cost={feeBps:0,slippageBps:0},base={schemaVersion:'trade-tp-before-sl-v1',kind:'tp_before_sl_probability',outcomeVersion:'trade-barriers-v1',entryPolicy:'next-closed-bar-boundary-v1',maxEntryDelayMs:60000,symbol:'BTC/USD',source:'Test fixture',trainedThrough:'2025-01-01T00:00:00Z',featureNames:['x','y'],maxBars:16,cost,algorithm:'logistic',predictor:{weights:[1,-2],intercept:.2,mean:[2,1],scale:[2,3]},calibration:{method:'platt',a:1.2,b:-.1}},context={symbol:base.symbol,source:base.source,cost,maxBars:16,asOf:Date.UTC(2026,0,1)};
test('portable logistic inference standardizes and calibrates raw margins',()=>{
 const margin=.2+1*(4-2)/2-2*(4-1)/3,expected=1/(1+Math.exp(-(1.2*margin-.1)));
 assert.ok(Math.abs(predictTradeProbability([4,4],base,context)-expected)<1e-14);
});
test('portable LightGBM sums native leaf values once and calibrates its raw score',()=>{
 const node={split_feature:0,decision_type:'<=',threshold:2,default_left:true,missing_type:'None',left_child:{leaf_value:.2},right_child:{leaf_value:.7}},model={...base,algorithm:'lightgbm',predictor:{modelDump:{objective:'binary sigmoid:1',num_class:1,max_feature_idx:1,average_output:false,tree_info:[{shrinkage:.1,tree_structure:node},{shrinkage:.1,tree_structure:{leaf_value:.3}}]}}};
 assert.equal(predictTradeProbability([1,0],model,context),1/(1+Math.exp(-(.5*1.2-.1))));
 assert.equal(predictTradeProbability([3,0],model,context),1/(1+Math.exp(-(1*1.2-.1))));
});
test('displayed confidence must exceed 60 and cannot round 60.0 into a trade',()=>{
 assert.equal(confidenceFromProbability(.60049),60);assert.equal(passesTradeConfidence(.60049),false);assert.equal(passesTradeConfidence(.6),false);assert.equal(passesTradeConfidence(.601),true);assert.equal(passesTradeConfidence(null),false);assert.equal(confidenceFromProbability(1.1),null);
});
test('mismatched event, source, costs, expiry, feature order, future training and invalid values reject models',()=>{
 for(const [model,ctx] of [[{...base,kind:'direction_probability'},context],[base,{...context,source:'Other'}],[base,{...context,cost:{...cost,slippageBps:1}}],[base,{...context,maxBars:8}],[base,{...context,featureNames:['y','x']}],[{...base,trainedThrough:'2027-01-01'},context],[{...base,predictor:{...base.predictor,weights:[Infinity,0]}},context]])assert.equal(validateTradeModel(model,ctx).valid,false);
 assert.equal(predictTradeProbability([NaN,1],base,context),null);
});
const publication={policyVersion:'trade-publication-v1',passed:true,status:'paper',outcomeVersion:'trade-barriers-v1',entryPolicy:base.entryPolicy,maxEntryDelayMs:60000,symbol:base.symbol,source:base.source,maxBars:16,cost,nonOverlapping:200,positive:100,negative:100,aboveThreshold:40,brier:.1,baselineBrier:.25,netExpectancy:.3,expectancyInterval:[.1,.5],evaluatedThroughMs:Date.UTC(2025,11,1)};
test('publication guard enforces each minimum and positive block-bootstrap lower bound',()=>{
 assert.equal(validateTradePublication(publication,context).valid,true);
 for(const report of [{...publication,nonOverlapping:199},{...publication,positive:39,negative:161},{...publication,aboveThreshold:29},{...publication,brier:.3},{...publication,expectancyInterval:[0,.5]},{...publication,evaluatedThroughMs:Date.UTC(2027,0,1)},{...publication,cost:{...cost,feeBps:1}}])assert.equal(validateTradePublication(report,context).valid,false);
 assert.equal(validateTradeModel(base,{...context,requirePublication:true}).reason,'unpublished-trade-model');
 assert.equal(validateTradeModel({...base,publication},{...context,requirePublication:true}).valid,true);
 const legacy={...base,publication};delete legacy.entryPolicy;delete legacy.maxEntryDelayMs;
 assert.equal(validateTradeModel(legacy,context).valid,true);assert.equal(validateTradeModel(legacy,{...context,requirePublication:true}).reason,'model-entry-policy-mismatch');
 assert.equal(validateTradePublication({...publication,entryPolicy:undefined},context).reason,'publication-entry-policy-mismatch');
 assert.equal(validateTradeModel({...base,maxEntryDelayMs:60001},context).reason,'model-entry-policy-mismatch');
});
// Synthetic data is confined to this independent LightGBM 4.7.0 oracle fixture;
// it is never a live/provider observation or a publishable model.
const specialOracles=JSON.parse(readFileSync(new URL('./fixtures/lightgbm-special-oracle.json',import.meta.url)));
test('Python LightGBM oracle confirms near-zero missing and categorical truncation semantics',()=>{
 for(const oracle of specialOracles)for(const observation of oracle.observations){
  assert.ok(Math.abs(predictTradeMargin(observation.features,oracle.model)-observation.rawScore)<1e-12,oracle.mode+' '+observation.features);
  assert.ok(Math.abs(predictTradeProbability(observation.features,oracle.model)-observation.probability)<1e-12);
 }
});
test('linear-leaf LightGBM dumps are rejected rather than silently scored as constant leaves',()=>{
 const model=structuredClone(specialOracles[0].model),root=model.predictor.modelDump.tree_info[0].tree_structure;
 let leaf=root;while(!Object.hasOwn(leaf,'leaf_value'))leaf=leaf.left_child;leaf.leaf_const=1;leaf.leaf_coeff=[2];
 assert.equal(validateTradeModel(model).reason,'invalid-model-predictor');
});
