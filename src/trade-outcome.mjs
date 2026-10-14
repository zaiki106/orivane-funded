import {executionPlan,exitQuotePrice} from './execution-plan.mjs';
import {roundTripFee,validTradingCost} from './cost-policy.mjs';

export const tradeOutcomeKind='tp_before_sl_probability';
export const tradeOutcomeVersion='trade-barriers-v1';
export const tradeIntervalMs=900000;
export const tradeEntryPolicy='next-closed-bar-boundary-v1';
export const tradeMaxEntryDelayMs=60000;
const positive=x=>Number.isFinite(x)&&x>0;
const timestamp=x=>typeof x==='number'?x:Date.parse(x);
const validTimestamp=x=>Number.isSafeInteger(x)&&Math.abs(x)<=8640000000000000;
const validSide=side=>side==='BUY'||side==='SELL';

// Stops and objectives stay at their closed-candle values. executionPlan applies
// entry slippage once; settlement applies exit slippage and round-trip fees once.
export function makeTradePlan(raw,quote,cost,{entryTime,executionTime=entryTime,maxBars=16,intervalMs=tradeIntervalMs,entryPolicy=tradeEntryPolicy,maxEntryDelayMs=tradeMaxEntryDelayMs}={}){
 const start=timestamp(entryTime),executed=timestamp(executionTime);
 if(!validSide(raw?.side)||!Number.isSafeInteger(start)||!Number.isSafeInteger(executed)||!Number.isSafeInteger(maxBars)||maxBars<1||maxBars>96||!Number.isSafeInteger(intervalMs)||intervalMs<=0||Math.abs(start)>8640000000000000||Math.abs(start+maxBars*intervalMs)>8640000000000000||entryPolicy!==tradeEntryPolicy||maxEntryDelayMs!==tradeMaxEntryDelayMs||start%intervalMs!==0||executed<start||executed>=start+maxBars*intervalMs||executed-start>maxEntryDelayMs)throw Error('Plan de trade invalide');
 const plan=executionPlan(raw,quote,cost);
 return Object.freeze({...plan,side:raw.side,strategy:raw.strategy??null,atr:raw.atr,version:tradeOutcomeVersion,kind:tradeOutcomeKind,
  entryTime:new Date(start).toISOString(),entryTimeMs:start,expiryTime:new Date(start+maxBars*intervalMs).toISOString(),expiryTimeMs:start+maxBars*intervalMs,maxBars,intervalMs,
  entryPolicy,maxEntryDelayMs,executionTime:new Date(executed).toISOString(),executionTimeMs:executed,
  cost:Object.freeze({...plan.cost})});
}
export function validTradePlan(plan){
 const dir=plan?.side==='BUY'?1:plan?.side==='SELL'?-1:0;
 if(!plan?.valid||!dir||plan.kind!==tradeOutcomeKind||plan.version!==tradeOutcomeVersion||!validTradingCost(plan.cost)||![plan.referenceEntry,plan.entry,plan.stop,plan.target,plan.netRisk,plan.netReward].every(positive)||dir*(plan.referenceEntry-plan.stop)<=0||dir*(plan.target-plan.referenceEntry)<=0||dir*(plan.entry-plan.stop)<=0||dir*(plan.target-plan.entry)<=0||!Number.isFinite(plan.entryTimeMs)||!Number.isFinite(plan.expiryTimeMs)||plan.expiryTimeMs<=plan.entryTimeMs||!Number.isSafeInteger(plan.maxBars)||plan.maxBars<1||plan.maxBars>96||!Number.isSafeInteger(plan.intervalMs)||plan.intervalMs<=0||plan.expiryTimeMs-plan.entryTimeMs!==plan.maxBars*plan.intervalMs)return false;
 if(typeof plan.entryTime!=='string'||typeof plan.expiryTime!=='string'||!Number.isSafeInteger(plan.entryTimeMs)||!Number.isSafeInteger(plan.expiryTimeMs)||Date.parse(plan.entryTime)!==plan.entryTimeMs||Date.parse(plan.expiryTime)!==plan.expiryTimeMs)return false;
 // Old journals may lack an execution policy. New plans bind the setup boundary
 // and physical execution separately, without extending the forecast deadline.
 if(['entryPolicy','maxEntryDelayMs','executionTime','executionTimeMs'].some(k=>Object.hasOwn(plan,k))&&(plan.entryPolicy!==tradeEntryPolicy||plan.maxEntryDelayMs!==tradeMaxEntryDelayMs||plan.entryTimeMs%plan.intervalMs!==0||!Number.isSafeInteger(plan.executionTimeMs)||typeof plan.executionTime!=='string'||Date.parse(plan.executionTime)!==plan.executionTimeMs||plan.executionTimeMs<plan.entryTimeMs||plan.executionTimeMs>=plan.expiryTimeMs||plan.executionTimeMs-plan.entryTimeMs>tradeMaxEntryDelayMs))return false;
 const exitStop=plan.stop*(1-dir*plan.cost.slippageBps/10000),exitTarget=plan.target*(1-dir*plan.cost.slippageBps/10000),risk=dir*(plan.entry-exitStop)+roundTripFee(plan.cost,plan.entry,exitStop),reward=dir*(exitTarget-plan.entry)-roundTripFee(plan.cost,plan.entry,exitTarget),equal=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
 return equal(plan.netRisk,risk)&&equal(plan.netReward,reward)&&equal(plan.netRR,reward/risk);
}
export function tradeSettlement(plan,grossExit){
 if(!validTradePlan(plan)||!positive(grossExit))return null;
 const dir=plan.side==='BUY'?1:-1,exit=grossExit*(1-dir*plan.cost.slippageBps/10000),fees=roundTripFee(plan.cost,plan.entry,exit),grossPnl=dir*(exit-plan.entry),netPnl=grossPnl-fees;
 const netR=netPnl/plan.netRisk;
 return [exit,fees,grossPnl,netPnl,netR].every(Number.isFinite)?{grossExit,exit,fees,grossPnl,netPnl,netR}:null;
}
function finish(plan,status,price,time,extra={}){
 const settlement=tradeSettlement(plan,price);
 if(!settlement)return {status:'censored',y:null,censored:true,reason:'invalid-exit'};
 return {status,y:status==='target'?1:0,censored:false,labelEndTime:new Date(time).toISOString(),labelEndTimeMs:time,...settlement,...extra};
}
const invalid=reason=>({status:'censored',y:null,censored:true,reason});
function observationTime(item){return timestamp(item?.eventTimeMs??item?.eventTime??item?.providerTime??item?.timeMs??item?.time??item?.timestamp??item?.asOf??item?.receivedAt);}

// Incremental seam for paper execution. A BUY exits at Bid and a SELL at Ask.
// Calling this function does not mutate either the plan or the observation.
export function observeTradeOutcome(plan,observation,{mode='quote'}={}){
 if(!validTradePlan(plan))return invalid('invalid-plan');
 const time=observationTime(observation),dir=plan.side==='BUY'?1:-1;
 if(!validTimestamp(time)||time<(plan.executionTimeMs??plan.entryTimeMs))return invalid('invalid-observation-time');
 if(observation?.gap||observation?.sequenceGap)return invalid('observation-gap');
 if(mode==='quote'||mode==='ticks'){
  if(observation.bid!=null&&observation.ask!=null&&(!positive(observation.bid)||!positive(observation.ask)||observation.bid>observation.ask))return invalid('invalid-book');
  const price=exitQuotePrice(observation,plan.side);if(!positive(price))return invalid('invalid-quote');
  if(time>=plan.expiryTimeMs)return finish(plan,'expired',price,time,{basis:positive(observation[dir===1?'bid':'ask'])?dir===1?'bid':'ask':'last-price',expiryObservedLate:time>plan.expiryTimeMs});
  if(dir*(price-plan.stop)<=0)return finish(plan,'stop',price,time,{basis:dir===1?'bid':'ask'});
  if(dir*(price-plan.target)>=0)return finish(plan,'target',price,time,{basis:dir===1?'bid':'ask'});
  return {status:'open',y:null,censored:false};
 }
 if(mode!=='ohlc')return invalid('unknown-observation-mode');
 if((plan.executionTimeMs??plan.entryTimeMs)>plan.entryTimeMs)return invalid('intrabar-entry-needs-ticks');
 const b=observation;
 if(![b.open,b.high,b.low,b.close].every(positive)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||b.closed===false)return invalid('invalid-ohlc');
 if(time>=plan.expiryTimeMs)return finish(plan,'expired',b.open,time,{basis:'ohlc-last-price',convention:'stop-first-same-candle'});
 const end=time+plan.intervalMs;
 // OHLC cannot determine intrabar event order. The same-candle convention is
 // intentionally adverse, and recorded separately from tick-exact outcomes.
 if(dir===1?b.low<=plan.stop:b.high>=plan.stop){const price=dir===1?Math.min(plan.stop,b.open):Math.max(plan.stop,b.open);return finish(plan,'stop',price,end,{basis:'ohlc-last-price',convention:'stop-first-same-candle',ambiguous:dir===1?b.high>=plan.target:b.low<=plan.target});}
 if(dir===1?b.high>=plan.target:b.low<=plan.target)return finish(plan,'target',plan.target,end,{basis:'ohlc-last-price',convention:'stop-first-same-candle',ambiguous:false});
 if(end>=plan.expiryTimeMs)return finish(plan,'expired',b.close,plan.expiryTimeMs,{basis:'ohlc-last-price',convention:'stop-first-same-candle'});
 return {status:'open',y:null,censored:false};
}

export function labelTradeOutcome(plan,observations,{mode='ohlc'}={}){
 if(!validTradePlan(plan)||!Array.isArray(observations))return invalid('invalid-plan-or-observations');
 if(mode==='ohlc'&&(plan.executionTimeMs??plan.entryTimeMs)>plan.entryTimeMs)return invalid('intrabar-entry-needs-ticks');
 let previous=mode==='ohlc'?plan.entryTimeMs-plan.intervalMs:-Infinity,count=0;
 for(const observation of observations){
  const time=observationTime(observation);
  if(!validTimestamp(time))return invalid('invalid-observation-time');
  if(time<(plan.executionTimeMs??plan.entryTimeMs))continue;
  if(time<=previous||mode==='ohlc'&&time!==previous+plan.intervalMs)return invalid('observation-gap');
  previous=time;count++;
  const result=observeTradeOutcome(plan,observation,{mode});
  if(result.status!=='open')return {...result,observations:count};
 }
 return {...invalid('incomplete-horizon'),observations:count};
}
