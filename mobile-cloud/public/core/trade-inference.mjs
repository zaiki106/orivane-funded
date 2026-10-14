import {validTradingCost} from './cost-policy.mjs';
import {tradeOutcomeKind,tradeOutcomeVersion,tradeEntryPolicy,tradeMaxEntryDelayMs} from './trade-outcome.mjs';

export const tradeModelVersion='trade-tp-before-sl-v1';
export const tradePublicationVersion='trade-publication-v1';
export const tradeSignalPolicy=Object.freeze({id:'trade-confidence-above-60-v1',minimumPercent:60,comparison:'>',kind:tradeOutcomeKind});
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const finite=Number.isFinite;
const stamp=x=>typeof x==='number'?x:Date.parse(x);
const equivalentCost=(a,b)=>validTradingCost(a)&&validTradingCost(b)&&['feeBps','slippageBps','feePerUnit'].every(k=>(a[k]??0)===(b[k]??0));
export function confidenceFromProbability(probability){return finite(probability)&&probability>=0&&probability<=1?Math.round(probability*1000)/10:null;}
// The displayed value is the public contract: 60.0 is HOLD, never BUY/SELL.
export function passesTradeConfidence(probability){const percent=confidenceFromProbability(probability);return percent!==null&&percent>tradeSignalPolicy.minimumPercent;}
function featureContract(model,expected){return Array.isArray(model?.featureNames)&&model.featureNames.length>0&&model.featureNames.length<=256&&new Set(model.featureNames).size===model.featureNames.length&&model.featureNames.every(x=>typeof x==='string'&&x.length>0)&&(!expected||expected.length===model.featureNames.length&&expected.every((x,i)=>x===model.featureNames[i]));}
function validTree(node,width,state){
 if(!node||++state.nodes>200000||++state.depth>128)return false;
 if(Object.hasOwn(node,'leaf_value')){state.depth--;return finite(node.leaf_value)&&!Object.hasOwn(node,'leaf_const')&&!Object.hasOwn(node,'leaf_coeff');}
 const valid=Number.isSafeInteger(node.split_feature)&&node.split_feature>=0&&node.split_feature<width&&typeof node.default_left==='boolean'&&(node.decision_type==='<='&&finite(node.threshold)||node.decision_type==='=='&&typeof node.threshold==='string'&&node.threshold.split('||').every(x=>/^\d+$/.test(x)))&&validTree(node.left_child,width,state)&&validTree(node.right_child,width,state);
 state.depth--;return valid;
}
function validPredictor(model){
 const p=model?.predictor,n=model?.featureNames?.length;
 if(model?.algorithm==='logistic')return p&&finite(p.intercept)&&[p.weights,p.mean,p.scale].every(v=>Array.isArray(v)&&v.length===n&&v.every(finite))&&p.scale.every(x=>x>0);
 if(model?.algorithm!=='lightgbm')return false;
 const d=p?.modelDump;
 if(!d||typeof d.objective!=='string'||!/^binary(?:\s|$)/.test(d.objective)||d.num_class!==1||d.average_output===true||d.max_feature_idx!==n-1||!Array.isArray(d.tree_info)||d.tree_info.length<1||d.tree_info.length>2048)return false;
 return d.tree_info.every(tree=>validTree(tree.tree_structure,n,{nodes:0,depth:0}));
}
export function validateTradeModel(model,{symbol,source,asOf=Date.now(),featureNames,cost,maxBars=16,strategyMode,h1Policy,registryVersion,entryPolicy=tradeEntryPolicy,maxEntryDelayMs=tradeMaxEntryDelayMs,requirePublication=false}={}){
 const time=stamp(asOf),trained=stamp(model?.trainedThroughMs??model?.trainedThrough);
 const failed=reason=>({valid:false,reason});
 if(model==null)return failed('missing-trade-model');
 if(model?.schemaVersion!==tradeModelVersion||model?.kind!==tradeOutcomeKind||model?.outcomeVersion!==tradeOutcomeVersion)return failed('incompatible-target-model');
 if(!featureContract(model,featureNames)||!validPredictor(model))return failed('invalid-model-predictor');
 if(model.calibration?.method!=='platt'||![model.calibration.a,model.calibration.b].every(finite))return failed('invalid-model-calibration');
 if(typeof model.symbol!=='string'||!model.symbol||typeof model.source!=='string'||!model.source)return failed('missing-model-provenance');
 if(symbol&&model.symbol!==symbol||source&&model.source!==source)return failed('model-source-mismatch');
 if(!finite(time)||!finite(trained)||trained>time)return failed('future-model');
 if(model.trainedThroughMs!=null&&model.trainedThrough!=null&&stamp(model.trainedThrough)!==model.trainedThroughMs)return failed('inconsistent-model-time');
 if(!validTradingCost(model.cost)||cost&&!equivalentCost(model.cost,cost))return failed('model-cost-mismatch');
 if(model.maxBars!==maxBars)return failed('model-expiry-mismatch');
 if(strategyMode&&model.strategyMode!==strategyMode||h1Policy&&model.h1Policy!==h1Policy||registryVersion&&model.registryVersion!==registryVersion)return failed('model-strategy-context-mismatch');
 // A compatible legacy predictor remains observable. Publishing it requires
 // an explicit execution-window contract from the actual training export.
 if((model.entryPolicy!=null||model.maxEntryDelayMs!=null||requirePublication)&&(model.entryPolicy!==entryPolicy||model.maxEntryDelayMs!==maxEntryDelayMs))return failed('model-entry-policy-mismatch');
 if(requirePublication){const publication=validateTradePublication(model.publication,{symbol:model.symbol,source:model.source,cost:model.cost,maxBars,entryPolicy,maxEntryDelayMs,asOf:time});if(!publication.valid)return failed(publication.reason);if(stamp(model.publication.evaluatedThroughMs??model.publication.evaluatedThrough)<trained)return failed('evidence-before-model-calibration');}
 return {valid:true,reason:null};
}
export function validateTradePublication(report,{symbol,source,cost,maxBars=16,entryPolicy=tradeEntryPolicy,maxEntryDelayMs=tradeMaxEntryDelayMs,asOf=Date.now()}={}){
 const failure=reason=>({valid:false,reason});
 if(report?.policyVersion!==tradePublicationVersion||report.passed!==true||report.status!=='paper'||report.outcomeVersion!==tradeOutcomeVersion)return failure('unpublished-trade-model');
 if(report.entryPolicy!==entryPolicy||report.maxEntryDelayMs!==maxEntryDelayMs)return failure('publication-entry-policy-mismatch');
 if(!['nonOverlapping','positive','negative','aboveThreshold'].every(k=>Number.isSafeInteger(report[k])&&report[k]>=0)||report.nonOverlapping<200||report.positive<40||report.negative<40||report.positive+report.negative!==report.nonOverlapping||report.aboveThreshold<30||report.aboveThreshold>report.nonOverlapping)return failure('insufficient-out-of-sample-trades');
 if(![report.brier,report.baselineBrier,report.netExpectancy].every(finite)||report.brier<0||report.brier>1||report.baselineBrier<0||report.baselineBrier>1||report.brier>=report.baselineBrier||report.netExpectancy<=0||!Array.isArray(report.expectancyInterval)||report.expectancyInterval.length!==2||!report.expectancyInterval.every(finite)||report.expectancyInterval[0]<=0||report.expectancyInterval[0]>report.expectancyInterval[1])return failure('unvalidated-trade-edge');
 const evaluated=stamp(report.evaluatedThroughMs??report.evaluatedThrough),time=stamp(asOf);
 if(!finite(evaluated)||!finite(time)||evaluated>time)return failure('future-publication-evidence');
 if(report.symbol!==symbol||report.source!==source||report.maxBars!==maxBars||!equivalentCost(report.cost,cost))return failure('publication-context-mismatch');
 return {valid:true,reason:null};
}
function treeScore(node,features){
 while(!Object.hasOwn(node,'leaf_value')){
  const value=features[node.split_feature],category=Math.trunc(value);
  // Matches Tree::NumericalDecision and Tree::CategoricalDecision in pinned
  // LightGBM v4.7.0/tree.h. kZeroThreshold is defined as a float literal there.
  const left=node.decision_type==='=='?category>=0&&node.threshold.split('||').some(x=>Number(x)===category):node.missing_type==='Zero'&&Math.abs(value)<=Math.fround(1e-35)?node.default_left:value<=node.threshold;
  node=left?node.left_child:node.right_child;
 }
 return node.leaf_value;
}
export function predictTradeMargin(features,model,context={}){
 const validation=validateTradeModel(model,context);
 if(!validation.valid||!Array.isArray(features)||features.length!==model.featureNames.length||features.some(x=>!finite(x)))return null;
 const p=model.predictor;
 const margin=model.algorithm==='logistic'?p.intercept+features.reduce((sum,x,j)=>sum+p.weights[j]*(x-p.mean[j])/p.scale[j],0):p.modelDump.tree_info.reduce((sum,t)=>sum+treeScore(t.tree_structure,features),0);
 return finite(margin)?margin:null;
}
export function predictTradeProbability(features,model,context={}){
 const margin=predictTradeMargin(features,model,context);if(margin===null)return null;
 // Both exporters calibrate the raw decision margin, never an already-sigmoided
 // probability. LightGBM leaf_values already contain the learning rate.
 const probability=sigmoid(model.calibration.a*margin+model.calibration.b);
 return finite(probability)?probability:null;
}
