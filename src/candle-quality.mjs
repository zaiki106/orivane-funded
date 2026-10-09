// Recent-window inspection only; no sorting, interpolation or invented candles.
export function candleQuality(bars,{now=Date.now(),timeframe=15}={}){
  if(!Array.isArray(bars)||!Number.isFinite(now)||!Number.isFinite(timeframe)||timeframe<=0)return {status:'unavailable',reason:'Fenêtre indisponible',scanned:0};
  const interval=timeframe*60000;
  if(!Number.isFinite(interval))return {status:'unavailable',reason:'Intervalle indisponible',scanned:0};
  const closed=bars.filter(b=>b?.closed!==false);
  let invalid=0,unfinished=0,duplicates=0,outOfOrder=0,gaps=0,missingIntervals=0;
  const seen=new Set();let previous=null;
  for(const b of closed){
    if(!b||typeof b!=='object'){invalid++;previous=null;continue;}
    const t=Date.parse(b.time),valid=[b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close)&&Number.isFinite(b.volume)&&b.volume>=0;
    if(!Number.isFinite(t)||!valid)invalid++;
    if(Number.isFinite(t)&&t+interval>now)unfinished++;
    if(Number.isFinite(t)){if(seen.has(t))duplicates++;seen.add(t);}
    if(previous!==null&&Number.isFinite(t)){
      if(t<previous)outOfOrder++;
      if(t-previous>interval){gaps++;missingIntervals+=Math.max(0,Math.ceil((t-previous)/interval)-1);}
    }
    previous=Number.isFinite(t)?t:null;
  }
  const status=!closed.length?'unavailable':invalid||unfinished||duplicates||outOfOrder?'invalid':gaps?'gaps':'complete';
  return {scope:'recent-closed-candles',status,scanned:closed.length,formingExcluded:bars.length-closed.length,invalid,unfinished,duplicates,outOfOrder,gaps,missingIntervals,
    from:closed[0]?.time??null,to:closed.at(-1)?.time??null,reason:status==='complete'?'Fenêtre consécutive et valide':status==='gaps'?'Interruptions de cotation ou bougies manquantes ; aucune interpolation':status==='invalid'?'Bougies incohérentes ou non terminées':'Aucune bougie clôturée'};
}
