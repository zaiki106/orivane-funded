import {strategies,backtest,metrics} from './engine.mjs';
import {costForSymbol} from './cost-policy.mjs';
// Expanding chronological train windows. Selection cannot see the next fold.
// Research diagnostics never authorize a live order or alter its confidence.
export function walkForwardResearch(dataset){
 const bars=dataset.bars.filter(b=>b.closed!==false),n=bars.length,cost=costForSymbol(dataset.symbol),contextCache={bars,values:new Map()},folds=[];
 if(n<240)return {status:'insufficient',folds:[],reason:'240 bougies clôturées requises'};
 for(let i=0;i<3;i++){
  const start=Math.floor(n*(.5+i/6)),end=Math.floor(n*(.5+(i+1)/6));
  const candidates=strategies.map(s=>({id:s.id,train:backtest(bars,s.id,{...cost,end:start,contextCache})}));
  const selected=candidates.filter(c=>c.train.n>=20&&c.train.expectancy>0).sort((a,b)=>b.train.expectancy-a.train.expectancy||a.id.localeCompare(b.id))[0];
  folds.push({trainThrough:bars[start-1].time,testFrom:bars[start].time,testTo:bars[end-1].time,selected:selected?.id??null,train:selected?metrics(selected.train.trades):null,test:selected?backtest(bars,selected.id,{...cost,start,end,contextCache}):null});
 }
 const trades=folds.flatMap(f=>f.test?.trades??[]),report=metrics(trades);
 return {status:report.n>=20?'available':'insufficient',kind:'expanding-train-walk-forward',selection:'train-only-net-expectancy',refitsModel:false,confidenceUnchanged:true,folds,metrics:report,expectancyInterval:blockBootstrap(trades.map(t=>t.r)),cost};
}
export function blockBootstrap(values,{iterations=400,block=3,seed=20261013}={}){
 if(!Array.isArray(values)||values.some(v=>!Number.isFinite(v))||!Number.isInteger(iterations)||iterations<100||iterations>10000||!Number.isInteger(block)||block<1)throw Error('Bootstrap invalide');
 if(values.length<20)return {status:'insufficient',sample:values.length,interval:null};
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;},means=[];
 for(let k=0;k<iterations;k++){const sample=[];while(sample.length<values.length){const from=Math.floor(random()*values.length);for(let j=0;j<Math.min(block,values.length)&&sample.length<values.length;j++)sample.push(values[(from+j)%values.length]);}means.push(sample.reduce((s,x)=>s+x,0)/sample.length);}
 means.sort((a,b)=>a-b);return {status:'available',sample:values.length,iterations,block,seed,confidenceLevel:.95,interval:[means[Math.floor(iterations*.025)],means[Math.ceil(iterations*.975)-1]],kind:'circular-moving-block-mean-R',independenceAssumed:false};
}
