// Pure historical research diagnostics. No execution, account access or forecast.
const finite = (v, name) => {if(!Number.isFinite(v))throw new TypeError(`${name} must be finite`);return v;};
const positive = (v,name) => {finite(v,name);if(v<=0)throw new RangeError(`${name} must be positive`);return v;};
const text = (v,name) => {if(typeof v!=='string'||!v.trim())throw new TypeError(`${name} must be nonempty`);};
function settings(minSamples){if(!Number.isInteger(minSamples)||minSamples<2)throw new RangeError('minSamples must be an integer >= 2');}
function identities(items){
 if(!Array.isArray(items))throw new TypeError('Expected an array');
 const ids=new Set();
 for(const p of items){if(!p||typeof p!=='object')throw new TypeError('Invalid item');text(p.id,'id');text(p.symbol,'symbol');if(ids.has(p.id))throw new Error('Duplicate id');ids.add(p.id);if(!['BUY','SELL'].includes(p.side))throw new Error('Invalid side');}
}
function histories(returns){
 if(!returns||typeof returns!=='object'||Array.isArray(returns))throw new TypeError('returns must be a symbol map');
 const result=new Map();
 for(const [symbol,rows] of Object.entries(returns)){
  if(!Array.isArray(rows))throw new TypeError('History must be an array');
  let previous=-Infinity;const values=new Map();
  for(const row of rows){if(!row||typeof row!=='object')throw new TypeError('Invalid return');finite(row.timeMs,'timeMs');finite(row.value,'return');if(row.timeMs<=previous)throw new Error('History times must increase uniquely');previous=row.timeMs;values.set(row.timeMs,row.value);}
  result.set(symbol,values);
 }
 return result;
}
function align(symbols,data){
 if(!symbols.length)return [];
 const first=data.get(symbols[0]);if(!first)return [];
 return [...first].filter(([time])=>symbols.every(s=>data.get(s)?.has(time))).map(([timeMs])=>({timeMs,values:symbols.map(s=>data.get(s).get(timeMs))}));
}
function moments(values){
 const scale=values.reduce((maximum,v)=>Math.max(maximum,Math.abs(v)),Number.MIN_VALUE);
 const normalized=values.map(v=>v/scale),mean=normalized.reduce((a,b)=>a+b,0)/normalized.length;
 const centered=normalized.map(v=>v-mean),sumSquares=centered.reduce((a,b)=>a+b*b,0);
 return {centered,sumSquares,volatility:Math.sqrt(sumSquares/(values.length-1))*scale};
}
function correlation(a,b,data,minSamples){
 const rows=align([a,b],data),sample=rows.length;
 if(sample<minSamples)return {symbols:[a,b],status:'insufficient',sample,correlation:null,reason:'insufficient-aligned-samples'};
 const x=moments(rows.map(r=>r.values[0])),y=moments(rows.map(r=>r.values[1]));
 if(x.sumSquares===0||y.sumSquares===0)return {symbols:[a,b],status:'insufficient',sample,correlation:null,reason:'constant-series'};
 const covariance=x.centered.reduce((sum,v,i)=>sum+v*y.centered[i],0);
 return {symbols:[a,b],status:'available',sample,correlation:Math.max(-1,Math.min(1,covariance/Math.sqrt(x.sumSquares*y.sumSquares)))};
}
/** Returns gross stop exposure (never netted) plus historical fixed-notional scenarios.
 * Return values must use matching periodic return units and timestamp semantics.
 * Stops are not applied to historical scenarios; gaps, costs and execution are absent.
 */
export function portfolioRisk(positions,returns,{equity,maxTotalRiskPercent=2,maxSymbolRiskPercent=1,correlationLimit=.8,minSamples=30}={}){
 positive(equity,'equity');positive(maxTotalRiskPercent,'maxTotalRiskPercent');positive(maxSymbolRiskPercent,'maxSymbolRiskPercent');settings(minSamples);
 if(!Number.isFinite(correlationLimit)||correlationLimit<0||correlationLimit>1)throw new RangeError('Invalid correlationLimit');
 identities(positions);const data=histories(returns),perSymbolMap=new Map(),violations=[];
 const enriched=positions.map(p=>{
  positive(p.entry,'entry');positive(p.stop,'stop');positive(p.quantity,'quantity');const multiplier=p.contractMultiplier===undefined?1:p.contractMultiplier;positive(multiplier,'contractMultiplier');
  if((p.side==='BUY'&&p.stop>=p.entry)||(p.side==='SELL'&&p.stop<=p.entry))throw new Error('Stop must be adverse to entry');
  const stopRisk=finite(Math.abs(p.entry-p.stop)*p.quantity*multiplier,'stopRisk'),notional=finite(p.entry*p.quantity*multiplier,'notional');
  perSymbolMap.set(p.symbol,finite((perSymbolMap.get(p.symbol)??0)+stopRisk,'symbolRisk'));
  return {...p,stopRisk,notional};
 });
 const percent=v=>finite(v/equity*100,'riskPercent');
 const perSymbol=[...perSymbolMap].map(([symbol,stopRisk])=>({symbol,stopRisk,riskPercent:percent(stopRisk)}));
 const totalStopRisk=finite(perSymbol.reduce((sum,p)=>sum+p.stopRisk,0),'totalStopRisk'),totalStopRiskPercent=percent(totalStopRisk);
 if(totalStopRiskPercent>maxTotalRiskPercent)violations.push({code:'TOTAL_RISK_LIMIT',actual:totalStopRiskPercent,limit:maxTotalRiskPercent});
 for(const p of perSymbol)if(p.riskPercent>maxSymbolRiskPercent)violations.push({code:'SYMBOL_RISK_LIMIT',symbol:p.symbol,actual:p.riskPercent,limit:maxSymbolRiskPercent});
 const symbols=perSymbol.map(p=>p.symbol),pairCorrelations=[];
 for(let i=0;i<symbols.length;i++)for(let j=i+1;j<symbols.length;j++)pairCorrelations.push(correlation(symbols[i],symbols[j],data,minSamples));
 const adjacent=(a,b)=>a.side===b.side&&(a.symbol===b.symbol||pairCorrelations.some(p=>p.symbols.includes(a.symbol)&&p.symbols.includes(b.symbol)&&p.status==='available'&&p.correlation>=correlationLimit));
 const visited=new Set(),correlatedClusters=[];
 for(let i=0;i<enriched.length;i++){
  if(visited.has(i))continue;const indices=[i];visited.add(i);
  for(let k=0;k<indices.length;k++)for(let j=0;j<enriched.length;j++)if(!visited.has(j)&&adjacent(enriched[indices[k]],enriched[j])){visited.add(j);indices.push(j);}
  if(indices.length>1){const group=indices.map(j=>enriched[j]),stopRisk=group.reduce((s,p)=>s+p.stopRisk,0),cluster={positionIds:group.map(p=>p.id),symbols:[...new Set(group.map(p=>p.symbol))],side:group[0].side,stopRisk,riskPercent:percent(stopRisk)};correlatedClusters.push(cluster);violations.push({code:'CORRELATED_EXPOSURE',positionIds:cluster.positionIds,riskPercent:cluster.riskPercent});}
 }
 const rows=align(symbols,data),losses=rows.map(row=>{const loss=finite(-enriched.reduce((sum,p)=>sum+(p.side==='BUY'?1:-1)*p.notional*row.values[symbols.indexOf(p.symbol)],0),'scenarioLoss');return {timeMs:row.timeMs,loss,lossPercent:percent(loss)};});
 const available=symbols.length>0&&rows.length>=minSamples,sorted=losses.map(x=>x.loss).sort((a,b)=>a-b),tailSample=available?Math.max(1,Math.ceil(sorted.length*.05)):0;
 const scenarios={status:available?'available':'insufficient',sample:rows.length,losses,valueAtRisk95:available?sorted[Math.ceil(sorted.length*.95)-1]:null,expectedShortfall95:available?finite(sorted.slice(-tailSample).reduce((sum,v)=>sum+v/tailSample,0),'expectedShortfall95'):null,tailSample,caveat:'Empirical worst ceil(5% × N) periods; finite sample, no coverage guarantee or forecast. Fixed entry notionals; no stops, compounding, gaps or costs. Matching periodic return semantics are required.'};
 return {status:available&&pairCorrelations.every(p=>p.status==='available')?'available':'insufficient',totalStopRisk,totalStopRiskPercent,perSymbol,pairCorrelations,correlatedClusters,violations,scenarios,realTradingAuthorized:false};
}
/** Proposed research budget only. Inverse volatility, actual capped weights and
 * conservative exclusion when diversification evidence is missing or concentrated.
 */
export function allocateResearchRisk(candidates,returns,{budgetPercent=2,maxWeight=.5,minSamples=30}={}){
 positive(budgetPercent,'budgetPercent');positive(maxWeight,'maxWeight');if(maxWeight>1)throw new RangeError('maxWeight must be <= 1');settings(minSamples);identities(candidates);const data=histories(returns);
 const allocations=candidates.map(c=>{
  const values=[...(data.get(c.symbol)?.values()??[])],sample=values.length,reasons=[];
  const volatility=sample>=minSamples?finite(moments(values).volatility,'volatility'):null;
  if(sample<minSamples)reasons.push('insufficient-samples');else if(volatility===0)reasons.push('constant-series');
  return {...c,status:reasons.length?'excluded':'eligible',sample,volatility,weight:0,riskPercent:0,reasons};
 });
 const selected=[];
 for(const candidate of allocations.filter(c=>c.status==='eligible').sort((a,b)=>a.volatility-b.volatility||a.id.localeCompare(b.id))){
  for(const prior of selected){
   if(prior.symbol===candidate.symbol){candidate.reasons.push('duplicate-symbol');break;}
   const evidence=correlation(prior.symbol,candidate.symbol,data,minSamples);
   if(evidence.status!=='available'){candidate.reasons.push('insufficient-diversification-evidence');break;}
   if(prior.side===candidate.side&&evidence.correlation>=.8){candidate.reasons.push('same-side-correlated');break;}
   // Opposite-side negative correlations also concentrate signed exposure.
   if(prior.side!==candidate.side&&evidence.correlation<=-.8){candidate.reasons.push('opposite-side-anticorrelated');break;}
  }
  if(candidate.reasons.length)candidate.status='excluded';else selected.push(candidate);
 }
 const minimumVol=selected.length?selected.reduce((minimum,c)=>Math.min(minimum,c.volatility),Infinity):0;
 const total=selected.reduce((sum,c)=>sum+minimumVol/c.volatility,0);
 for(const c of selected){c.weight=Math.min(maxWeight,(minimumVol/c.volatility)/total);c.riskPercent=c.weight*budgetPercent;c.reasons.push('inverse-volatility-research-budget');if(c.weight===maxWeight)c.reasons.push('weight-cap');}
 const allocatedRiskPercent=selected.reduce((sum,c)=>sum+c.riskPercent,0);
 return {status:selected.length?'available':'insufficient',allocations,budgetPercent,allocatedRiskPercent,unallocatedRiskPercent:Math.max(0,budgetPercent-allocatedRiskPercent),realTradingAuthorized:false};
}
