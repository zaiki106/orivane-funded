// Preserve source times; an ahead-of-device clock must not poison all history.
export function normalizeKrakenHistory(payload,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||payload?.ohlc?.error?.length||payload?.ticker?.error?.length)throw Error('Réponse Kraken invalide');
 const histories=Object.entries(payload?.ohlc?.result??{}).filter(([key,value])=>key!=='last'&&Array.isArray(value));
 const tickers=Object.values(payload?.ticker?.result??{});
 if(histories.length!==1||tickers.length!==1)throw Error('Instrument Kraken ambigu');
 const source=histories[0][1],ticker=tickers[0],serverTime=Date.parse(payload.receivedAt),offsetMs=Number.isFinite(serverTime)?serverTime-now:null;
 const clockSkewDetected=offsetMs!==null&&Math.abs(offsetMs)>60000;
 let previous=-Infinity,futureBarsRejected=0;const bars=[];let currentBar=null;
 for(let i=0;i<source.length;i++){
  const row=source[i];if(!Array.isArray(row)||row.length<8)throw Error('Schéma historique Kraken incomplet');
  const time=Number(row[0])*1000,values=[row[1],row[2],row[3],row[4],row[6]].map(Number),[open,high,low,close,volume]=values;
  if(!Number.isSafeInteger(time)||time%900000||time<=previous||!values.every(Number.isFinite)||![open,high,low,close].every(v=>v>0)||volume<0||high<Math.max(open,close,low)||low>Math.min(open,close,high))throw Error('Bougies Kraken invalides ou désordonnées');previous=time;
  const bar={time:new Date(time).toISOString(),open,high,low,close,volume,trades:Number(row[7])};
  // Kraken always includes an uncommitted final entry. Never use it for training.
  if(time>now){futureBarsRejected++;continue;}
  if(i===source.length-1||time+900000>now){if(!clockSkewDetected&&time<=now&&time+900000>now)currentBar={...bar,closed:false};else if(time+900000>now)futureBarsRejected++;continue;}
  bars.push({...bar,closed:true});
 }
 if(!bars.length)throw Error('Aucune bougie Kraken clôturée disponible pour l’horloge de cet appareil');
 const price=Number(ticker.c?.[0]),bid=Number(ticker.b?.[0]),ask=Number(ticker.a?.[0]);
 if(![price,bid,ask].every(v=>Number.isFinite(v)&&v>0)||bid>ask)throw Error('Cotation Kraken invalide');
 return {symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,bars,currentBar,
  quote:{price,bid,ask,receivedAt:new Date(now).toISOString(),serverReceivedAt:payload.receivedAt??null,transport:'rest'},
  provenance:{clockSkewDetected,serverReceivedAt:payload.receivedAt??null,localReceivedAt:new Date(now).toISOString(),clockOffsetMs:offsetMs,futureBarsRejected,clockBasis:'server-receipt-versus-device-not-synchronized-network-latency'}};
}
