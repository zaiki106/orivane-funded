// Chart-only aggregation. It cannot alter the 15-minute decision engine.
export function aggregateChartBars(bars,minutes=15,{now=Date.now()}={}){
 if(![15,60,240].includes(minutes)||!Array.isArray(bars)||!Number.isFinite(now))throw Error('Unité graphique invalide');
 const interval=900000,width=minutes*60000,groups=new Map();
 for(const b of bars){const time=Date.parse(b?.time);if(!Number.isFinite(time)||time%interval!==0||time>now||![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.low>b.high)continue;const key=Math.floor(time/width)*width;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...b,time:new Date(time).toISOString()});}
 const result=[];
 for(const [start,group] of [...groups].sort((a,b)=>a[0]-b[0])){
  group.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(Date.parse(group[0].time)!==start||group.some((b,i)=>i&&Date.parse(b.time)-Date.parse(group[i-1].time)!==interval))continue;
  const complete=group.length===minutes/15&&group.every(b=>b.closed!==false),active=start+width>now;
  if(!complete&&!active)continue;
  // A duplicate timestamp or incomplete old bucket is never silently filled.
  result.push({time:new Date(start).toISOString(),open:group[0].open,high:Math.max(...group.map(b=>b.high)),low:Math.min(...group.map(b=>b.low)),close:group.at(-1).close,volume:group.every(b=>Number.isFinite(b.volume)&&b.volume>=0)?group.reduce((s,b)=>s+b.volume,0):null,closed:complete&&!active,sourceBars:group.length,timeframe:minutes});
 }
 return result;
}
