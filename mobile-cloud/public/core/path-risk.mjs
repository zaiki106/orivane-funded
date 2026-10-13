// Stationary sampler adapted from bashtage/arch, revision
// 72bb33821b7c45f431defab3043aca424d89a58c. See THIRD_PARTY_NOTICES.
// Historical research only: these paths are not forecasts or funded pass odds.
export function stationaryIndices(indices,uniforms,probability){
 const n=indices.length;
 if(!n||uniforms.length!==n||!Number.isFinite(probability)||probability<=0||probability>1||indices.some(i=>!Number.isInteger(i)||i<0||i>=n)||uniforms.some(u=>!Number.isFinite(u)||u<0||u>=1))throw Error('Échantillonnage stationnaire invalide');
 const result=indices.slice();
 for(let i=1;i<n;i++)if(uniforms[i]>probability)result[i]=(result[i-1]+1)%n;
 return result;
}
export function pathSummary(values,riskPercent=.5){
 if(!Array.isArray(values)||values.some(v=>!Number.isFinite(v))||!Number.isFinite(riskPercent)||riskPercent<=0||riskPercent>1)throw Error('Parcours invalide');
 let equity=1,peak=1,drawdown=0,totalR=0,run=0,longest=0,ruined=false;
 for(const r of values){totalR+=r;run=r<0?run+1:0;longest=Math.max(longest,run);equity*=Math.max(0,1+r*riskPercent/100);if(equity===0)ruined=true;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak*100);}
 return {totalR,returnPercent:(equity-1)*100,maxDrawdownPercent:drawdown,maxLosingStreak:longest,ruined};
}
const quantiles=values=>{const sorted=values.slice().sort((a,b)=>a-b);return [.05,.5,.95].map(p=>{const x=(sorted.length-1)*p,i=Math.floor(x);return sorted[i]+(sorted[Math.ceil(x)]-sorted[i])*(x-i);});};
export function pathRisk(values,{iterations=800,meanBlock=3,seed=20261013,riskPercent=.5}={}){
 if(!Array.isArray(values)||values.length>10000||values.some(v=>!Number.isFinite(v))||!Number.isInteger(iterations)||iterations<100||iterations>2000||!Number.isFinite(meanBlock)||meanBlock<1||meanBlock>100||!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('Stress historique invalide');
 const observed=pathSummary(values,riskPercent);
 if(values.length<20)return {status:'insufficient',sample:values.length,minimum:20,observed,forecast:false,confidenceUnchanged:true};
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const paths=[];
 for(let k=0;k<iterations;k++){
  const indices=values.map(()=>Math.floor(random()*values.length)),uniforms=values.map(()=>random());
  paths.push(pathSummary(stationaryIndices(indices,uniforms,1/meanBlock).map(i=>values[i]),riskPercent));
 }
 return {status:'available',kind:'stationary-block-historical-paths',sample:values.length,horizonTrades:values.length,iterations,meanBlock,seed,riskPercent,quantileLevels:[.05,.5,.95],observed,
  returnPercent:quantiles(paths.map(p=>p.returnPercent)),maxDrawdownPercent:quantiles(paths.map(p=>p.maxDrawdownPercent)),maxLosingStreak:quantiles(paths.map(p=>p.maxLosingStreak)),negativePathFraction:paths.filter(p=>p.returnPercent<0).length/iterations,ruinedPathFraction:paths.filter(p=>p.ruined).length/iterations,forecast:false,confidenceUnchanged:true};
}
