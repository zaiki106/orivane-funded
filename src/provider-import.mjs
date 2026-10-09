import {readFileSync,statSync} from 'node:fs';
import {validateBars} from './engine.mjs';

export const importInstruments=Object.freeze({
  'BTC/USD':{yahoo:'BTC-USD',type:'CRYPTOCURRENCY',name:'Bitcoin / US Dollar'},
  'EUR/USD':{yahoo:'EURUSD=X',type:'CURRENCY',name:'Euro / US Dollar'},
  'GBP/USD':{yahoo:'GBPUSD=X',type:'CURRENCY',name:'British Pound / US Dollar'},
  'XAU/USD':{yahoo:null,type:'COMMODITY',name:'Gold Spot / US Dollar'},
  'NDX':{yahoo:'^NDX',type:'INDEX',name:'Nasdaq-100 Index'}
});
const iso=time=>new Date(time).toISOString();
const number=value=>value===null||value===undefined||value===''?NaN:Number(value);
const positive=value=>Number.isFinite(value)&&value>0;
const parsePayload=value=>typeof value==='string'?JSON.parse(value):value;
function validTime(value){const time=Date.parse(value);if(!Number.isFinite(time))throw Error('Horodatage fournisseur absent ou invalide');return time;}
const zoneFormatters=new Map();
function zoneFormatter(timezone){
  if(typeof timezone!=='string'||!timezone)throw Error('Fuseau fournisseur explicite requis');
  if(!zoneFormatters.has(timezone)){
    try{zoneFormatters.set(timezone,new Intl.DateTimeFormat('en-CA-u-ca-iso8601',{timeZone:timezone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}));}
    catch{throw Error('Fuseau fournisseur IANA invalide');}
  }
  return zoneFormatters.get(timezone);
}
function zonedEpoch(time,formatter){const parts=Object.fromEntries(formatter.formatToParts(time).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);}
export function providerTimeToUTC(value,timezone){
  if(typeof value!=='string')throw Error('Horodatage fournisseur absent ou invalide');
  if(/(?:Z|[+-]\d\d:\d\d)$/.test(value))return iso(validTime(value));
  if(!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(value))throw Error('Horodatage local fournisseur invalide');
  const local=validTime(value.replace(' ','T')+'Z'),formatter=zoneFormatter(timezone),offsets=new Set();
  // Probe either side of DST transitions, then verify candidates against the IANA zone.
  for(const delta of [-86400000,0,86400000]){const probe=local+delta;offsets.add(zonedEpoch(probe,formatter)-probe);}
  const candidates=[...offsets].map(offset=>local-offset).filter(candidate=>zonedEpoch(candidate,formatter)===local);
  if(candidates.length!==1)throw Error(candidates.length?'Heure locale ambiguë : offset fournisseur requis':'Heure locale inexistante dans le fuseau fournisseur');
  return iso(candidates[0]);
}

function finalise({symbol,provider,providerSymbol,rows,quote,provenance,fetchedAt,now}){
  if(!rows.length)throw Error('Aucune bougie fournisseur valide');
  const ordered=rows.sort((a,b)=>a.time.localeCompare(b.time));
  const checked=validateBars(ordered,now);
  if(checked.some(bar=>Date.parse(bar.time)>now))throw Error('Bougie fournisseur future');
  const bars=checked.filter(bar=>Date.parse(bar.time)+900000<=now),forming=checked.filter(bar=>Date.parse(bar.time)+900000>now);
  if(forming.length>1)throw Error('Plusieurs bougies en formation incohérentes');
  if(bars.length<60)throw Error('60 bougies clôturées minimum pour importer');
  const source=provider+' · '+(symbol==='NDX'?'Nasdaq-100 index':symbol);
  if(quote){
    if(!positive(quote.price)||validTime(quote.receivedAt)>now+60000)throw Error('Cotation fournisseur invalide');
    quote={...quote,source,transport:'import',capturedAt:fetchedAt};
  }
  const staleAt=iso(Math.min(Date.parse(fetchedAt)+120000,Date.parse(quote?.receivedAt??bars.at(-1).time)+120000));
  return {symbol,source,timeframe:15,receivedAt:fetchedAt,staleAt,live:false,isRealtime:false,
    bars,currentBar:forming[0]?{...forming[0],closed:false,source,receivedAt:fetchedAt,transport:'import'}:null,quote,
    provenance:{provider,providerSymbol,instrumentName:importInstruments[symbol].name,
      mode:'snapshot',isRealtime:false,fetchedAt,staleAt,marketAsOf:quote?.receivedAt??bars.at(-1).time,
      ...provenance},quality:{volumeAvailable:checked.some(bar=>bar.volume>0),omittedBars:provenance.omittedBars??0}};
}

function nasdaqRegularSessions(meta){
  const raw=Array.isArray(meta.tradingPeriods)?meta.tradingPeriods:meta.tradingPeriods?.regular;
  if(!Array.isArray(raw))throw Error('Sessions Nasdaq fournisseur absentes');
  const periods=raw.flat(2);
  if(!periods.length||periods.length>1000||periods.some(period=>!Number.isSafeInteger(period?.start)||!Number.isSafeInteger(period?.end)||period.start<0||period.end<=period.start))throw Error('Sessions Nasdaq fournisseur invalides');
  const sessions=periods.map(({start,end})=>({start,end})).sort((a,b)=>a.start-b.start);
  if(sessions.some((session,index)=>index>0&&session.start<sessions[index-1].end))throw Error('Sessions Nasdaq fournisseur incohérentes');
  return sessions;
}

function fromYahoo({symbol,payload,fetchedAt,now}){
  const instrument=importInstruments[symbol],result=payload?.chart?.result;
  if(payload?.chart?.error||!Array.isArray(result)||result.length!==1)throw Error('Yahoo Finance : données indisponibles');
  const data=result[0],meta=data.meta,prices=data.indicators?.quote?.[0];
  if(!instrument.yahoo||meta?.symbol!==instrument.yahoo||meta.instrumentType!==instrument.type)throw Error('Instrument fournisseur différent : substitution refusée');
  if(meta.dataGranularity!=='15m')throw Error('Intervalle fournisseur différent de 15 minutes');
  if(!Array.isArray(data.timestamp)||!prices||data.timestamp.length>20000)throw Error('Historique fournisseur invalide');
  const sessions=symbol==='NDX'?nasdaqRegularSessions(meta):null;
  let omittedBars=0;const rows=[];
  for(let index=0;index<data.timestamp.length;index++){
    const seconds=number(data.timestamp[index]),values=['open','high','low','close'].map(key=>number(prices[key]?.[index]));
    // Null OHLC slots and the occasional unaligned quote-summary row are not candles.
    if(!Number.isFinite(seconds)||seconds%900!==0||values.some(value=>!Number.isFinite(value))){omittedBars++;continue;}
    // The aligned value at the regular close is a closing summary, not a new 15-minute interval.
    if(sessions&&!sessions.some(session=>seconds>=session.start&&seconds+900<=session.end)){omittedBars++;continue;}
    const volume=prices.volume?.[index];rows.push({time:iso(seconds*1000),open:values[0],high:values[1],low:values[2],close:values[3],volume:volume===null||volume===undefined?0:number(volume)});
  }
  const quoteTime=number(meta.regularMarketTime),price=number(meta.regularMarketPrice);
  const quote=positive(price)&&Number.isFinite(quoteTime)?{price,bid:null,ask:null,receivedAt:iso(quoteTime*1000),eventTime:iso(quoteTime*1000)}:null;
  const regular=meta.currentTradingPeriod?.regular,marketOpen=Number.isFinite(regular?.start)&&Number.isFinite(regular?.end)?now>=regular.start*1000&&now<regular.end*1000:null;
  return finalise({symbol,provider:'Yahoo Finance',providerSymbol:meta.symbol,rows,quote,fetchedAt,now,
    provenance:{instrumentType:meta.instrumentType,exchange:meta.fullExchangeName??meta.exchangeName,
      marketTimezone:meta.exchangeTimezoneName??null,providerDelaySeconds:null,providerReportedDelayRaw:meta.exchangeDataDelayedBy??null,
      marketOpen,endpointKind:'public-unofficial',omittedBars,...(sessions?{sessionValidated:true,historyMode:'canonical-provider-snapshot'}:{})}});
}

function fromTwelve({symbol,payload,quote:quotePayload,fetchedAt,now,timezone:explicitTimezone}){
  const meta=payload?.meta;
  if(payload?.status==='error'||!meta||!Array.isArray(payload.values)||payload.values.length>20000)throw Error('Twelve Data : données indisponibles');
  if(meta.symbol!==symbol)throw Error('Instrument fournisseur différent : substitution refusée');
  if(meta.interval!=='15min')throw Error('Intervalle fournisseur différent de 15 minutes');
  if(symbol==='NDX'&&!/index/i.test(meta.type??''))throw Error('Indice Nasdaq réel requis : ETF et actions refusés');
  if(symbol==='XAU/USD'&&/ETF|Stock|Equity/i.test(meta.type??''))throw Error('Or spot requis : proxy refusé');
  const timezone=explicitTimezone??meta.timezone??meta.exchange_timezone??null;
  const rows=payload.values.map(value=>({time:providerTimeToUTC(value.datetime,timezone),open:number(value.open),high:number(value.high),low:number(value.low),close:number(value.close),volume:value.volume===undefined||value.volume===null?0:number(value.volume)}));
  let quote=null;const raw=quotePayload?parsePayload(quotePayload):null;
  if(raw){
    if(raw.status==='error'||raw.symbol!==symbol)throw Error('Cotation Twelve Data invalide ou instrument différent');
    const timestamp=raw.last_quote_at??raw.timestamp,time=typeof timestamp==='number'||/^\d+(\.\d+)?$/.test(String(timestamp))?number(timestamp)*1000:validTime(providerTimeToUTC(timestamp,raw.timezone??'UTC'));
    quote={price:number(raw.close),bid:null,ask:null,receivedAt:iso(time),eventTime:iso(time)};
  }
  return finalise({symbol,provider:'Twelve Data',providerSymbol:meta.symbol,rows,quote,fetchedAt,now,
    provenance:{instrumentType:meta.type??null,exchange:meta.exchange??null,marketTimezone:timezone,
      providerDelaySeconds:null,marketOpen:typeof raw?.is_market_open==='boolean'?raw.is_market_open:null,
      endpointKind:'authenticated-connector-import',omittedBars:0}});
}

// An import is a provider snapshot, even if fetched seconds ago. It never becomes a live stream.
export function normalizeProviderImport(input,now=Date.now()){
  if(!input||typeof input!=='object'||!importInstruments[input.symbol])throw Error('Instrument importé inconnu');
  const fetchedAt=iso(validTime(input.fetchedAt));if(Date.parse(fetchedAt)>now+60000)throw Error('Import futur');
  const parsed={...input,payload:parsePayload(input.payload),fetchedAt,now};
  if(input.provider==='Yahoo Finance')return fromYahoo(parsed);
  if(input.provider==='Twelve Data')return fromTwelve(parsed);
  throw Error('Fournisseur importé inconnu');
}

export function loadProviderImport(file,now=Date.now()){
  if(statSync(file).size>5000000)throw Error('Import fournisseur trop volumineux');
  return normalizeProviderImport(JSON.parse(readFileSync(file,'utf8')),now);
}

// Yahoo's public chart endpoint is a best-effort HTTP snapshot, not a documented live-trading API.
export async function fetchYahooSnapshot(symbol,{range='1mo',fetchImpl=globalThis.fetch,now=Date.now,signal}={}){
  const instrument=importInstruments[symbol];
  if(!instrument?.yahoo)throw Error('Instrument absent du fournisseur public');
  if(!['5d','1mo'].includes(range))throw Error('Période publique non prise en charge');
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(instrument.yahoo)+'?interval=15m&range='+range;
  const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Yahoo Finance HTTP '+response.status);
  const payload=await response.json(),time=now();
  return normalizeProviderImport({provider:'Yahoo Finance',symbol,payload,fetchedAt:iso(time)},time);
}
