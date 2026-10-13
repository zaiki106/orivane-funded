// Observation ages are clock differences, never measured network latency.
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const text=value=>typeof value==='string'&&value.trim()?value:null;
function timestamp(value){
  if(typeof value!=='string'||!value.trim())return null;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}
const iso=value=>value===null?null:new Date(value).toISOString();
const past=(value,now)=>{const time=timestamp(value);return time!==null&&time<=now?time:null;};
function validCandle(bar){
  return !!bar&&[bar.open,bar.high,bar.low,bar.close].every(positive)&&
    bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close);
}

/** Summarize only measurements present in a public radar row. Does not change decisions. */
export function marketHealth(market,{now=Date.now()}={}){
  const row=market&&typeof market==='object'?market:{},quote=row.quote&&typeof row.quote==='object'?row.quote:null;
  const source=text(row.source),transport=text(quote?.transport)??text(row.feed?.transport);
  const validNow=typeof now==='number'&&Number.isFinite(now)&&now>=0&&now<=8640000000000000;
  const interval=positive(row.timeframe)&&Number.isFinite(row.timeframe*60000)?row.timeframe*60000:null;
  // Import receivedAt is market time; capturedAt is the actual local capture.
  const receiptValue=quote?.localReceivedAt??quote?.capturedAt??(transport==='rest'?quote?.receivedAt:null);
  const eventValue=quote?.eventTime??(transport!=='rest'||quote?.localReceivedAt!=null||quote?.capturedAt!=null?quote?.receivedAt:null);
  const receipt=validNow?past(receiptValue,now):null,event=validNow?past(eventValue,now):null;
  const expectedEvent=eventValue!=null||transport==='websocket'||transport==='import';
  const quotePriceValid=positive(quote?.price);
  const presentBadBook=[quote?.bid,quote?.ask].some(value=>value!=null&&!positive(value));
  const crossed=positive(quote?.bid)&&positive(quote?.ask)&&quote.bid>quote.ask;
  const validBook=quotePriceValid&&!presentBadBook&&!crossed&&positive(quote?.bid)&&positive(quote?.ask);
  const spread=validBook?quote.ask-quote.bid:null;
  // Use the actual midpoint; the last trade can sit away from the best bid/ask.
  const midpoint=validBook?quote.bid/2+quote.ask/2:null;
  const spreadBps=validBook&&Number.isFinite(spread)&&Number.isFinite(midpoint)?spread/midpoint*10000:null;
  const budget=transport==='websocket'?30000:transport==='rest'||transport==='import'?120000:null;
  const deadline=timestamp(row.staleAt),feedState=text(row.feed?.status)??text(row.status);
  let state='unavailable';
  if(row.provenance?.marketOpen===false||feedState==='closed')state='closed';
  else if(['unavailable','offline','connecting','error','stale','historical'].includes(feedState))state=feedState;
  else if(validNow&&['live','snapshot'].includes(feedState)&&quotePriceValid&&!presentBadBook&&!crossed&&receipt!==null&&(!expectedEvent||event!==null)&&budget!==null){
    const expired=(deadline!==null&&now>=deadline)||now-receipt>=budget||(event!==null&&now-event>=budget);
    state=expired?'stale':feedState==='live'&&row.live===true?'live':
      feedState==='live'&&transport==='websocket'?'stale':'snapshot';
  }

  const closedTimes=validNow&&interval!==null&&Array.isArray(row.bars)?
    [...new Set(row.bars.filter(bar=>validCandle(bar)&&bar.closed!==false).map(bar=>timestamp(bar.time))
      .filter(time=>time!==null&&Number.isFinite(time+interval)&&time+interval<=now))].sort((a,b)=>a-b):[];
  const lastStart=closedTimes.at(-1)??null,lastClosed=lastStart===null?null:lastStart+interval;
  let consecutiveClosedBars=closedTimes.length?1:0;
  for(let i=closedTimes.length-1;i>0&&closedTimes[i]-closedTimes[i-1]===interval;i--)consecutiveClosedBars++;
  // Overnight/session breaks affect this count only; a valid NDX snapshot stays a snapshot.
  const formingStart=validNow&&interval!==null&&validCandle(row.currentBar)&&row.currentBar.closed!==true?past(row.currentBar.time,now):null;
  const formingBarProgressPct=formingStart!==null&&now<formingStart+interval?100*(now-formingStart)/interval:null;
  const trainedAt=validNow?past(row.model?.trainedAt,now):null;
  const modelSource=text(row.model?.source),modelConsistent=!modelSource||modelSource===source;
  const rawModelStatus=text(row.model?.status);
  const modelStatus=['pending','error','unavailable'].includes(rawModelStatus)?rawModelStatus:
    rawModelStatus==='ready'&&trainedAt!==null&&modelConsistent?'ready':'unavailable';
  return {symbol:text(row.symbol),source,state,transport,
    quoteAt:iso(receipt),quoteAgeMs:receipt===null?null:now-receipt,
    quoteEventAt:iso(event),quoteEventAgeMs:event===null?null:now-event,
    spread:spread!==null&&Number.isFinite(spread)?spread:null,spreadBps,
    lastClosedAt:iso(lastClosed),closedAgeMs:lastClosed===null?null:now-lastClosed,
    barCount:closedTimes.length,consecutiveClosedBars,formingBarProgressPct,
    modelStatus,modelAgeMs:modelStatus==='ready'?now-trainedAt:null};
}
