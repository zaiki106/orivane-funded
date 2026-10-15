// Descriptive, causal analysis. No calibration, trade permission or fabricated bars.
const interval=900000,maximum=720;
const iso=t=>new Date(t).toISOString();
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const numeric=v=>Number.isFinite(v)?v:null;
function collect(dataset,asOf){
 if(!Number.isSafeInteger(asOf)||asOf<0||asOf>8640000000000000)return {reason:'invalid-as-of'};
 if(dataset?.timeframe!==15||!Array.isArray(dataset.bars)||dataset.bars.length>50000)return {reason:'invalid-dataset'};
 const bars=[];
 for(let j=dataset.bars.length-1;j>=0&&bars.length<maximum;j--){
  const b=dataset.bars[j];if(!b||typeof b!=='object')return {reason:'invalid-bar'};if(b.closed===false)continue;
  if(typeof b.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(b.time))return {reason:'timezone-required'};
  const time=Date.parse(b.time),calendar=Date.parse(b.time.slice(0,10)+'T00:00:00Z');
  if(!Number.isSafeInteger(time)||!Number.isFinite(calendar)||iso(calendar).slice(0,10)!==b.time.slice(0,10)||Number(b.time.slice(11,13))>23||Number(b.time.slice(14,16))>59)return {reason:'invalid-time'};
  if(time+interval>asOf)continue;
  if(time%interval)return {reason:'unaligned-time'};
  if(![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))return {reason:'invalid-ohlc'};
  bars.push({...b,timeMs:time});
 }
 bars.reverse();let cut=0,gaps=0;for(let j=1;j<bars.length;j++){
  const delta=bars[j].timeMs-bars[j-1].timeMs;if(delta<=0)return {reason:'non-contiguous-history'};
  if(delta!==interval){cut=j;gaps++;}
 }
 // Keep the latest continuous segment. Never stitch a weekend or outage closed.
 return {bars:bars.slice(cut),discardedBars:cut,gaps};
}
export function aggregateClosedBars(bars,minutes){
 if(![15,60,240].includes(minutes))throw new RangeError('Unsupported analysis timeframe');
 const duration=minutes*60000,count=duration/interval,groups=new Map();
 for(const b of bars){const bucket=Math.floor(b.timeMs/duration)*duration;if(!groups.has(bucket))groups.set(bucket,[]);groups.get(bucket).push(b);}
 const result=[];
 for(const [time,rows] of groups){if(rows.length!==count||rows.some((b,j)=>b.timeMs!==time+j*interval))continue;
  result.push({time:iso(time),timeMs:time,open:rows[0].open,high:Math.max(...rows.map(b=>b.high)),low:Math.min(...rows.map(b=>b.low)),close:rows.at(-1).close,closed:true});
 }
 return result;
}
function emaSeries(values,period){let value=mean(values.slice(0,period));return values.map((v,i)=>{if(i<period-1)return null;if(i>=period)value=2/(period+1)*v+(1-2/(period+1))*value;return value;});}
function frameAnalysis(bars,minutes){
 const base={minutes,bars:bars.length,status:'insufficient',direction:'unavailable',lastClosedAt:bars.length?iso(bars.at(-1).timeMs+minutes*60000):null};
 if(bars.length<22)return {...base,reason:'insufficient-history',requiredBars:22};
 const closes=bars.map(b=>b.close),fast=emaSeries(closes,9),slow=emaSeries(closes,21),x=bars.at(-1);
 const ranges=bars.map((b,i)=>i?Math.max(b.high-b.low,Math.abs(b.high-closes[i-1]),Math.abs(b.low-closes[i-1])):b.high-b.low);
 let atr=mean(ranges.slice(0,14));for(let j=14;j<ranges.length;j++)atr=(13*atr+ranges[j])/14;
 if(!Number.isFinite(atr)||!Number.isFinite(fast.at(-1))||!Number.isFinite(slow.at(-1)))return {...base,reason:'numeric-features-unavailable'};
 const up=x.close>fast.at(-1)&&fast.at(-1)>slow.at(-1)&&fast.at(-1)>fast.at(-2),down=x.close<fast.at(-1)&&fast.at(-1)<slow.at(-1)&&fast.at(-1)<fast.at(-2);
 const channel=bars.slice(-21,-1),support=Math.min(...channel.map(b=>b.low)),resistance=Math.max(...channel.map(b=>b.high));
 const reference=ranges.slice(-61,-1),currentRange=ranges.at(-1);
 return {...base,status:'ready',reason:null,direction:up?'up':down?'down':'mixed',ema9:fast.at(-1),ema21:slow.at(-1),atr:numeric(atr),atrFraction:numeric(atr/x.close),
  support,resistance,close:x.close,breakout:x.close>resistance?'above':x.close<support?'below':'inside',
  distanceToSupportAtr:atr>0?numeric((x.close-support)/atr):null,distanceToResistanceAtr:atr>0?numeric((resistance-x.close)/atr):null,
  rangeRank:reference.length?100*reference.filter(v=>v<currentRange).length/reference.length:null,rangeReferenceSamples:reference.length};
}
export function buildMarketAnalysis(dataset,{asOf=Date.now()}={}){
 const history=collect(dataset,asOf),base={version:'market-analysis-v1',researchOnly:true,requiresPC:false,status:'insufficient',reason:history.reason??'insufficient-history',frames:[],referenceTime:null,closedBars:0,discardedBars:history.discardedBars??0,gaps:history.gaps??0};
 if(history.reason)return base;
 const bars=history.bars,frames=[15,60,240].map(minutes=>frameAnalysis(aggregateClosedBars(bars,minutes),minutes));
 return {...base,status:frames[0].status==='ready'?'ready':'insufficient',reason:frames[0].reason,closedBars:bars.length,referenceTime:bars.length?iso(bars.at(-1).timeMs+interval):null,frames};
}
export function summarizeStrategies(input){
 const rules=[...new Map((Array.isArray(input)?input:[]).filter(r=>r&&typeof r.id==='string').map(r=>[r.id,r])).values()];
 const families=new Map(),counts={total:rules.length,buy:0,sell:0,waiting:0,blocked:0},near=[];
 for(const rule of rules){
  const family=rule.family??'research';if(!families.has(family))families.set(family,{id:family,total:0,buy:0,sell:0,waiting:0,blocked:0});const f=families.get(family);f.total++;
  const key=rule.dataReady===false?'blocked':rule.side==='BUY'?'buy':rule.side==='SELL'?'sell':'waiting';counts[key]++;f[key]++;
  if(key!=='waiting')continue;
  for(const side of ['BUY','SELL']){const checks=rule.directionalChecks?.[side];if(!Array.isArray(checks)||!checks.length)continue;
   const met=checks.filter(c=>c?.passed===true).length;if(!met||met===checks.length)continue;
   near.push({id:rule.id,name:rule.name,family,side,met,total:checks.length,missing:checks.filter(c=>c?.passed!==true).map(c=>typeof c?.label==='string'?c.label:'Condition non documentée').slice(0,5)});
  }
 }
 near.sort((a,b)=>b.met/b.total-a.met/a.total||b.met-a.met||a.id.localeCompare(b.id));
 // At most one direction per rule; conditions are not independent probabilities.
 const ids=new Set(),nearest=near.filter(item=>{if(ids.has(item.id))return false;ids.add(item.id);return true;}).slice(0,6);
 return {version:'strategy-analysis-v1',researchOnly:true,...counts,conflict:counts.buy>0&&counts.sell>0,families:[...families.values()],nearest};
}
