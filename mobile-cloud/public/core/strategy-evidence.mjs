import {metrics} from './engine.mjs';
import {validTradingCost} from './cost-policy.mjs';

const minimumSample=20;
const sameNumber=(left,right)=>Number.isFinite(left)&&Number.isFinite(right)&&Math.abs(left-right)<=1e-9*Math.max(1,Math.abs(left),Math.abs(right));
const sameNullable=(left,right)=>left===null&&right===null||sameNumber(left,right);
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

function unavailable(strategy,reason,name=null){
  return {strategy:typeof strategy==='string'&&strategy.length?strategy:null,name,partition:'test',coverage:'closed-test-trades',minimumSample,status:'unavailable',reason,
    sample:null,wins:null,winRate:null,winInterval:null,expectancy:null,totalR:null,profitFactor:null,maxDrawdownR:null,cost:null,tradeFrom:null,tradeTo:null};
}

// This is a diagnostic of one rule already chosen elsewhere. It never ranks rules,
// chooses a model, changes a signal, or treats historical win rate as confidence.
// The caller must additionally match the laboratory's source and model version.
export function strategyEvidence(lab,strategyId){
  if(!lab||!Array.isArray(lab.results))return unavailable(strategyId,'missing-laboratory');
  if(lab.stale||['stale','unavailable','error'].includes(lab.status))return unavailable(strategyId,'stale-laboratory');
  if(typeof strategyId!=='string'||!strategyId.length)return unavailable(strategyId,'unknown-strategy');
  const matches=lab.results.filter(result=>result?.id===strategyId);
  if(matches.length!==1)return unavailable(strategyId,matches.length?'duplicate-strategy':'unknown-strategy');
  const result=matches[0],name=typeof result.name==='string'&&result.name.trim()?result.name:null,cost=result.cost;
  if(!name)return unavailable(strategyId,'invalid-strategy');
  if(!validTradingCost(cost)||typeof cost.assumption!=='boolean')return unavailable(strategyId,'invalid-cost-assumptions',name);
  const sample=result.test;
  if(!sample||!Number.isSafeInteger(sample.n)||sample.n<0||!Number.isSafeInteger(sample.wins)||sample.wins<0||sample.wins>sample.n||!Array.isArray(sample.trades)||sample.trades.length!==sample.n)return unavailable(strategyId,'invalid-test-metrics',name);
  let previousEntry=-Infinity,firstEntry=Infinity,lastExit=-Infinity;
  for(const trade of sample.trades){
    if(!trade||!Number.isFinite(trade.r)||!validDate(trade.time)||!validDate(trade.exitTime)||trade.strategy!=null&&trade.strategy!==strategyId)return unavailable(strategyId,'invalid-test-trades',name);
    const entry=Date.parse(trade.time),exit=Date.parse(trade.exitTime);
    if(exit<entry||entry<previousEntry)return unavailable(strategyId,'invalid-test-trades',name);
    previousEntry=entry;firstEntry=Math.min(firstEntry,entry);lastExit=Math.max(lastExit,exit);
  }
  // Validate the supplied summary against its actual closed trades. There is no
  // fallback to train or validation when a final-test metric is missing or wrong.
  const checked=metrics(sample.trades);
  if(checked.wins!==sample.wins||!['winRate','expectancy','totalR','profitFactor','maxDrawdownR'].every(key=>sameNullable(sample[key],checked[key])))return unavailable(strategyId,'invalid-test-metrics',name);
  const interval=sample.winInterval,expectedInterval=checked.winInterval;
  if(expectedInterval===null?interval!==null:!Array.isArray(interval)||interval.length!==2||!interval.every((value,i)=>sameNumber(value,expectedInterval[i])))return unavailable(strategyId,'invalid-test-metrics',name);
  return {strategy:strategyId,name,partition:'test',coverage:'closed-test-trades',minimumSample,status:sample.n>=minimumSample?'available':'insufficient',
    sample:sample.n,wins:sample.wins,winRate:sample.winRate,winInterval:interval===null?null:[...interval],expectancy:sample.expectancy,totalR:sample.totalR,profitFactor:sample.profitFactor,maxDrawdownR:sample.maxDrawdownR,
    cost:{...cost},
    tradeFrom:sample.n?new Date(firstEntry).toISOString():null,tradeTo:sample.n?new Date(lastExit).toISOString():null};
}
