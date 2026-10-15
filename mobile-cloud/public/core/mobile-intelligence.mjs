import {fitRegimes,inferRegime,distributionDrift} from './intelligence-ai.mjs';
import {intelligenceStrategies,analyzeIntelligenceContext,signalFromIntelligenceContext} from './intelligence-strategies.mjs';
import {evaluatePriceResearch} from './price-research.mjs';
import {buildMarketAnalysis} from './market-analysis.mjs';

const interval=900000,maximum=720,stride=8;
const featureNames=['atrFraction','ema20GapAtr','efficiency20','momentum8Atr','logVolumeRatio'];
const validAsOf=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const iso=value=>new Date(value).toISOString();
function emptyStrategies(reason){return intelligenceStrategies.map(rule=>({id:rule.id,name:rule.name,family:rule.family,formula:rule.formula,warmupBars:rule.warmupBars,
 side:'HOLD',entry:null,stop:null,target:null,atr:null,reason,researchOnly:true}));}
function emptyDrift(){return {status:'insufficient',referenceSamples:0,currentSamples:0,features:[],meanPsi:null,maxPsi:null,reasons:['historical_features_unavailable']};}
function vector(context){
 const volumeMean=context.bars.slice(-20).reduce((sum,bar)=>sum+bar.volume/20,0);
 return [context.atr/context.last.close,(context.last.close-context.ema20)/context.atr,
  context.er20,context.roc8Atr,Math.log(context.last.volume/volumeMean)];
}

/** Pure browser-side research summary; no PC, network, timers or account state.
 * Input timestamps are candle OPEN times. Only the latest 720 candles completed
 * at asOf are considered; future/forming appendages cannot move the split.
 * Each historical feature is computed from its own strictly causal prefix.
 * First 70% of sampled prefixes fit the frozen scaler/centroids and PSI bins;
 * the recent 30% never enters fitting. No probabilities or trading authorization
 * are produced. A ready context with zero setups is an ordinary valid result.
 */
export function buildMobileIntelligence(dataset,{asOf=Date.now()}={}){
 const result={version:'mobile-intelligence-v1',status:'insufficient',reason:'invalid-dataset',
  evaluatedAt:validAsOf(asOf)?iso(asOf):null,referenceTime:null,requiresPC:false,researchOnly:true,
  activeSetups:0,strategies:emptyStrategies('invalid-dataset'),priceStrategies:dataset?.timeframe===15&&Array.isArray(dataset.bars)&&dataset.bars.length<=50000&&validAsOf(asOf)?evaluatePriceResearch(dataset.bars,{asOf}):[],
  marketAnalysis:buildMarketAnalysis(dataset,{asOf}),regime:{status:'insufficient',regime:null,nearestDistance:null,reason:'historical_features_unavailable'},
  drift:emptyDrift(),training:{referenceSamples:0,currentSamples:0,featureNames:featureNames.slice(),
   referenceThrough:null,currentFrom:null,referenceScaler:null},volumeStatus:'unknown'};
 const fail=(reason,volumeStatus=result.volumeStatus)=>{
  result.status='insufficient';result.reason=reason;result.volumeStatus=volumeStatus;
  result.strategies=emptyStrategies(reason);return result;
 };
 if(!validAsOf(asOf))return fail('invalid-as-of');
 if(!dataset||typeof dataset!=='object'||dataset.timeframe!==15||!Array.isArray(dataset.bars)||dataset.bars.length>50000)return fail('invalid-dataset');
 const bars=[];
 for(let index=dataset.bars.length-1;index>=0&&bars.length<maximum;index--){
  const bar=dataset.bars[index];
  if(!bar||typeof bar!=='object')return fail('invalid-bar');
  if(bar.closed===false)continue;
  if(typeof bar.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(bar.time))return fail('timezone-required');
  const timestamp=Date.parse(bar.time);
  if(!Number.isSafeInteger(timestamp))return fail('invalid-time');
  const calendar=Date.parse(bar.time.slice(0,10)+'T00:00:00Z');
  if(!Number.isFinite(calendar)||iso(calendar).slice(0,10)!==bar.time.slice(0,10)||Number(bar.time.slice(11,13))>23||Number(bar.time.slice(14,16))>59)return fail('invalid-time');
  if(timestamp+interval>asOf)continue;
  bars.push({...bar,timestampMs:timestamp});
 }
 bars.reverse();
 if(bars.length)result.referenceTime=iso(bars.at(-1).timestampMs+interval);
 for(let i=0;i<bars.length;i++){
  const bar=bars[i];
  if(bar.timestampMs%interval!==0)return fail('unaligned-time');
  if(i&&bar.timestampMs-bars[i-1].timestampMs!==interval)return fail('non-contiguous-history');
  if(![bar.open,bar.high,bar.low,bar.close].every(value=>Number.isFinite(value)&&value>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))return fail('invalid-ohlc');
  if(bar.volumeUnavailable===true||bar.syntheticVolume===true||bar.volume==null||bar.volume===0)return fail('real-volume-required','unavailable');
  if(!Number.isFinite(bar.volume)||bar.volume<0)return fail('invalid-volume','invalid');
 }
 result.volumeStatus=bars.length?'available':'unknown';
 if(bars.length<120)return fail('insufficient-history');
 // One current context is shared by all six recipes and by the latest sample.
 const context=analyzeIntelligenceContext(bars,{nowMs:asOf});
 if(!context.valid)return fail(context.reason);
 const currentFeatures=vector(context);
 if(!currentFeatures.every(Number.isFinite))return fail('numeric-features-unavailable');
 const samples=[];
 const sampleIndices=[];for(let index=119;index<bars.length;index+=stride)sampleIndices.push(index);
 if(sampleIndices.at(-1)!==bars.length-1)sampleIndices.push(bars.length-1);
 for(const index of sampleIndices){
  const through=bars[index].timestampMs+interval;
  const historical=index===bars.length-1?context:analyzeIntelligenceContext(bars.slice(Math.max(0,index-239),index+1),{nowMs:through});
  if(!historical.valid)return fail(historical.reason);
  const features=vector(historical);
  if(!features.every(Number.isFinite))return fail('numeric-features-unavailable');
  samples.push({timeMs:through,features});
 }
 const split=Math.floor(samples.length*.7),reference=samples.slice(0,split),recent=samples.slice(split);
 const model=fitRegimes(reference.map(row=>row.features));
 const regime=inferRegime(currentFeatures,model);
 result.regime={status:regime.status,regime:regime.regime??null,nearestDistance:regime.nearestDistance??null,
  reason:regime.status==='estimated'?null:model.reason??regime.reason??'regime-unavailable'};
 result.drift=distributionDrift(reference.map(row=>row.features),recent.map(row=>row.features));
 result.training={referenceSamples:reference.length,currentSamples:recent.length,featureNames:featureNames.slice(),
  referenceThrough:reference.length?iso(reference.at(-1).timeMs):null,currentFrom:recent.length?iso(recent[0].timeMs):null,
  referenceScaler:model.status==='fitted'?{mean:model.scaler.mean.slice(),scale:model.scaler.scale.slice()}:null};
 result.strategies=intelligenceStrategies.map(rule=>{
  const signal=signalFromIntelligenceContext(context,rule.id);
  return {id:rule.id,name:rule.name,family:rule.family,formula:rule.formula,warmupBars:rule.warmupBars,side:signal.side,entry:signal.entry,stop:signal.stop,
   target:signal.target,atr:signal.atr,reason:signal.reason,researchOnly:true};
 });
 result.activeSetups=result.strategies.filter(rule=>rule.side==='BUY'||rule.side==='SELL').length;
 result.status='ready';result.reason=result.regime.status==='estimated'&&result.drift.status==='measured'?'ready':'context-ready-diagnostics-insufficient';
 return result;
}
