// Independent research recipes. They do not promote models or alter the trading router.
export const intelligenceStrategiesVersion = 'orivane-intelligence-strategies-v1';
const intervalMs = 15 * 60_000;
const recipes = [
  ['intel-donchian55', 'Donchian 55 trend breakout', 'Close breaks the high/low of the preceding 55 bars; EMA55 agrees and slopes in the same direction.', 2, {channelPeriod:55}],
  ['intel-keltner20', 'Keltner 20 pullback resume', 'Previous close is behind EMA20 and wick reaches EMA20 ± ATR14; current close reclaims EMA20 with its five-bar trend slope.', 2, {emaPeriod:20,channelAtr:1,slopeBars:5}],
  ['intel-bollinger-release', 'Bollinger squeeze confirmed release', 'Prior BB20 population bandwidth is at/below the 20th percentile of 60 strictly earlier bandwidths; close crosses its prior 2σ band with volume > 1.5 times the preceding 20-bar mean.', 2, {bandPeriod:20,bandSigma:2,trainingBars:60,quantile:.2,volumeMultiple:1.5}],
  ['intel-failed20', 'Failed 20-bar breakout reversal', 'Previous close exits the preceding 20-bar channel; current close returns strictly inside that original channel with a reversal body.', 1.5, {channelPeriod:20}],
  ['intel-inside-contraction', 'Volatility contraction inside-bar breakout', 'Previous bar lies strictly inside its mother and has range < 0.7 prior ATR14; current close breaks the inside-bar high/low.', 2, {rangeAtr:.7}],
  ['intel-efficiency-momentum', 'Efficiency-filtered momentum', 'Kaufman ER20 ≥ 0.65 and price change over eight bars / ATR14 first crosses ±1.5.', 2, {efficiencyPeriod:20,efficiencyMinimum:.65,momentumPeriod:8,momentumAtr:1.5}],
];
export const intelligenceStrategies = Object.freeze(recipes.map(([id,name,formula,targetR,parameters])=>Object.freeze({
  id,name,family:id==='intel-failed20'?'reversion':id==='intel-inside-contraction'||id==='intel-bollinger-release'?'volatility':id==='intel-donchian55'?'breakout':'trend',version:intelligenceStrategiesVersion,researchOnly:true,status:'unvalidated-research',confidence:null,
  warmupBars:120,maxContextBars:240,timeframeMinutes:15,formula,
  prerequisites:Object.freeze(['Closed, contiguous, timezone-qualified UTC-aligned 15-minute OHLCV','Finite positive prices and real positive volume','No forming bars or future closes','No profitability or probability calibration claim']),
  parameters:Object.freeze({atrPeriod:14,stopAtr:1.5,targetR,...parameters}),
})));
const byId = new Map(intelligenceStrategies.map(rule=>[rule.id,rule]));
const mean = values=>values.reduce((sum,value)=>sum+value,0)/values.length;
function ema(values,period) {
  const result=Array(values.length).fill(null), alpha=2/(period+1);
  if(values.length<period)return result;
  result[period-1]=mean(values.slice(0,period));
  for(let i=period;i<values.length;i++)result[i]=alpha*values[i]+(1-alpha)*result[i-1];
  return result;
}
function wilder(values,period) {
  const result=Array(values.length).fill(null);
  if(values.length<period)return result;
  result[period-1]=mean(values.slice(0,period));
  for(let i=period;i<values.length;i++)result[i]=(result[i-1]*(period-1)+values[i])/period;
  return result;
}
function quantile(values,q) { const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*q,lo=Math.floor(index),fraction=index-lo;return sorted[lo]+fraction*(sorted[Math.ceil(index)]-sorted[lo]); }
const invalid = reason=>({valid:false,reason,bars:[],atr:null,ema20:null,ema55:null,er20:null,roc8Atr:null,bandwidth:null});

/** Input times are candle-open ISO timestamps, with an explicit UTC offset.
 * Only the trailing 240 completed bars are used; no history is fabricated.
 */
export function analyzeIntelligenceContext(input,{nowMs=Date.now(),requireVolume=true}={}) {
  if(!Array.isArray(input)||!Number.isFinite(nowMs))return invalid('invalid-input');
  const completed=[];
  for(let index=input.length-1;index>=0&&completed.length<240;index--){
    const bar=input[index];
    if(!bar||typeof bar!=='object')return invalid('invalid-bar');
    if(bar.closed===false)continue;
    if(typeof bar.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(bar.time))return invalid('timezone-required');
    const time=Date.parse(bar.time);
    if(!Number.isFinite(time))return invalid('invalid-time');
    const calendar=Date.parse(bar.time.slice(0,10)+'T00:00:00Z');
    if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==bar.time.slice(0,10)||Number(bar.time.slice(11,13))>23||Number(bar.time.slice(14,16))>59)return invalid('invalid-time');
    if(time+intervalMs>nowMs)continue;
    completed.push({...bar,timestampMs:time});
  }
  const bars=completed.reverse();
  if(bars.length<120)return invalid('insufficient-history');
  for(let i=0;i<bars.length;i++){
    const bar=bars[i];
    if(bar.timestampMs%intervalMs!==0)return invalid('unaligned-time');
    if(i&&bar.timestampMs-bars[i-1].timestampMs!==intervalMs)return invalid('non-contiguous-history');
    if(![bar.open,bar.high,bar.low,bar.close].every(value=>Number.isFinite(value)&&value>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))return invalid('invalid-ohlc');
    if(requireVolume&&(!Number.isFinite(bar.volume)||bar.volume<=0||bar.volumeUnavailable===true||bar.syntheticVolume===true))return invalid('real-volume-required');
  }
  const closes=bars.map(bar=>bar.close),ema20=ema(closes,20),ema55=ema(closes,55);
  const trueRange=bars.map((bar,i)=>i?Math.max(bar.high-bar.low,Math.abs(bar.high-closes[i-1]),Math.abs(bar.low-closes[i-1])):bar.high-bar.low);
  const atr=wilder(trueRange,14),bands=closes.map((close,i)=>{
    if(i<19)return null;const window=closes.slice(i-19,i+1),center=mean(window),deviation=Math.sqrt(mean(window.map(value=>(value-center)**2)));
    return {middle:center,upper:center+2*deviation,lower:center-2*deviation,bandwidth:4*deviation/center};
  });
  const er20=closes.map((close,i)=>{if(i<20)return null;let path=0;for(let j=i-19;j<=i;j++)path+=Math.abs(closes[j]-closes[j-1]);return path>0?Math.abs(close-closes[i-20])/path:0;});
  const roc8Atr=closes.map((close,i)=>i>=8&&atr[i]>0?(close-closes[i-8])/atr[i]:null);
  if(!(atr.at(-1)>0))return invalid('zero-atr');
  return {valid:true,reason:null,bars,last:bars.at(-1),previous:bars.at(-2),atr:atr.at(-1),ema20:ema20.at(-1),ema55:ema55.at(-1),er20:er20.at(-1),roc8Atr:roc8Atr.at(-1),bandwidth:bands.at(-1).bandwidth,
    series:{ema20,ema55,atr,bands,er20,roc8Atr},squeezeThreshold:quantile(bands.slice(-62,-2).map(value=>value.bandwidth),.2)};
}

/** Levels are anchored once to the completed setup close: stop 1.5 ATR, target recipe R. */
export function signalFromIntelligenceContext(context,id) {
  const rule=byId.get(id);if(!rule)throw new RangeError('Unknown intelligence strategy: '+id);
  const hold=reason=>Object.freeze({side:'HOLD',strategy:id,entry:null,stop:null,target:null,atr:context?.valid?context.atr:null,researchOnly:true,reason,confidence:null});
  if(!context?.valid)return hold(context?.reason||'invalid-context');
  const {bars,series,last:x,previous:p}=context,n=bars.length,i=n-1;
  let buy=false,sell=false;
  if(id==='intel-donchian55'){
    const channel=bars.slice(-56,-1);buy=x.close>Math.max(...channel.map(bar=>bar.high))&&x.close>context.ema55&&context.ema55>series.ema55[i-1];sell=x.close<Math.min(...channel.map(bar=>bar.low))&&x.close<context.ema55&&context.ema55<series.ema55[i-1];
  }else if(id==='intel-keltner20'){
    buy=p.low<=series.ema20[i-1]-series.atr[i-1]&&p.close<=series.ema20[i-1]&&x.close>context.ema20&&context.ema20>series.ema20[i-5];
    sell=p.high>=series.ema20[i-1]+series.atr[i-1]&&p.close>=series.ema20[i-1]&&x.close<context.ema20&&context.ema20<series.ema20[i-5];
  }else if(id==='intel-bollinger-release'){
    const prior=series.bands[i-1],volumeMean=mean(bars.slice(-21,-1).map(bar=>bar.volume));
    const squeeze=prior.bandwidth<=context.squeezeThreshold&&x.volume>rule.parameters.volumeMultiple*volumeMean;
    buy=squeeze&&p.close<=prior.upper&&x.close>prior.upper;sell=squeeze&&p.close>=prior.lower&&x.close<prior.lower;
  }else if(id==='intel-failed20'){
    const channel=bars.slice(-22,-2),high=Math.max(...channel.map(bar=>bar.high)),low=Math.min(...channel.map(bar=>bar.low));
    buy=p.close<low&&x.close>low&&x.close<high&&x.close>x.open;sell=p.close>high&&x.close<high&&x.close>low&&x.close<x.open;
  }else if(id==='intel-inside-contraction'){
    const mother=bars.at(-3),inside=p.high<mother.high&&p.low>mother.low&&(p.high-p.low)<.7*series.atr[i-1];
    buy=inside&&x.close>p.high;sell=inside&&x.close<p.low;
  }else if(id==='intel-efficiency-momentum'){
    buy=context.er20>=.65&&context.roc8Atr>1.5&&series.roc8Atr[i-1]<=1.5;
    sell=context.er20>=.65&&context.roc8Atr< -1.5&&series.roc8Atr[i-1]>= -1.5;
  }
  if(buy===sell)return hold('setup-not-confirmed');
  const direction=buy?1:-1,entry=x.close,risk=1.5*context.atr,stop=entry-direction*risk,target=entry+direction*risk*rule.parameters.targetR;
  if(![entry,stop,target].every(value=>Number.isFinite(value)&&value>0))return hold('invalid-risk-levels');
  return Object.freeze({side:buy?'BUY':'SELL',strategy:id,entry,stop,target,atr:context.atr,researchOnly:true,reason:'closed-setup-confirmed',confidence:null});
}
export function intelligenceSignal(bars,id,options) { return signalFromIntelligenceContext(analyzeIntelligenceContext(bars,options),id); }
