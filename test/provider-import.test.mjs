import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeProviderImport,loadProviderImport,fetchYahooSnapshot,providerTimeToUTC} from '../src/provider-import.mjs';

const begin=Date.parse('2026-10-08T12:00:00Z'),now=begin+600000,fetchedAt=new Date(now).toISOString();
function yahoo(providerSymbol='^NDX',type='INDEX'){
  const timestamp=Array.from({length:101},(_,index)=>(begin-(100-index)*900000)/1000);
  return {chart:{error:null,result:[{meta:{symbol:providerSymbol,instrumentType:type,dataGranularity:'15m',regularMarketPrice:101,regularMarketTime:(now-15000)/1000,exchangeName:'NIM',fullExchangeName:'Nasdaq GIDS',exchangeTimezoneName:'America/New_York',tradingPeriods:[[{start:timestamp[0],end:(begin+3600000)/1000}]],currentTradingPeriod:{regular:{start:(begin-3600000)/1000,end:(begin+3600000)/1000}}},timestamp,indicators:{quote:[{open:timestamp.map(()=>100),high:timestamp.map(()=>102),low:timestamp.map(()=>99),close:timestamp.map(()=>101),volume:timestamp.map(()=>0)}]}}]}};
}
function twelve(symbol='XAU/USD'){
  return {status:'ok',meta:{symbol,interval:'15min',exchange_timezone:'UTC',type:'Physical Currency'},values:Array.from({length:101},(_,index)=>({datetime:new Date(begin-index*900000).toISOString().replace('T',' ').replace('.000Z',''),open:'2500',high:'2502',low:'2499',close:'2501'}))};
}
const envelope=(payload,provider='Yahoo Finance',symbol='NDX',quote)=>({provider,symbol,payload,quote,fetchedAt});

test('true Nasdaq index import preserves timestamps and provenance, separates the forming candle, and stays a snapshot',()=>{
  const result=normalizeProviderImport(envelope(yahoo()),now);
  assert.equal(result.symbol,'NDX');assert.equal(result.provenance.providerSymbol,'^NDX');assert.equal(result.provenance.instrumentType,'INDEX');
  assert.match(result.source,/Nasdaq-100 index/);assert.equal(result.bars.length,100);assert.equal(result.currentBar.time,new Date(begin).toISOString());assert.equal(result.currentBar.closed,false);
  assert.equal(result.live,false);assert.equal(result.isRealtime,false);assert.equal(result.provenance.mode,'snapshot');
  assert.equal(result.quote.receivedAt,new Date(now-15000).toISOString());assert.equal(result.quote.capturedAt,fetchedAt);
  assert.equal(result.staleAt,new Date(now-15000+120000).toISOString());assert.equal(result.provenance.providerDelaySeconds,null);assert.equal(result.provenance.marketOpen,true);
});

test('Nasdaq closing summary outside the provider regular session is not a 15-minute candle; its quote remains intact',()=>{
  const payload=yahoo(),data=payload.chart.result[0],sessions=['2026-10-05','2026-10-06','2026-10-07'].map(day=>({start:Date.parse(day+'T13:30:00Z')/1000,end:Date.parse(day+'T20:00:00Z')/1000}));
  data.meta.tradingPeriods=sessions.map(session=>[session]);
  data.timestamp=sessions.flatMap(session=>Array.from({length:26},(_,i)=>session.start+i*900));
  const closingSummary=sessions.at(-1).end;data.timestamp.push(closingSummary);
  data.indicators.quote=[Object.fromEntries(['open','high','low','close','volume'].map(field=>[field,data.timestamp.map((_,i)=>field==='volume'?(i===78?0:100):i===78?31160.076171875:{open:31100,high:31155,low:31099,close:31150}[field])]))];
  data.meta.regularMarketPrice=31160.076;data.meta.regularMarketTime=Date.parse('2026-10-07T21:15:59Z')/1000;
  const result=normalizeProviderImport(envelope(payload),now);
  assert.equal(result.bars.length,78);assert.equal(result.bars.at(-1).time,'2026-10-07T19:45:00.000Z');
  assert.ok(result.bars.every(bar=>Date.parse(bar.time)!==closingSummary*1000));assert.equal(result.currentBar,null);
  assert.equal(result.quote.price,31160.076);assert.equal(result.quote.receivedAt,'2026-10-07T21:15:59.000Z');
  assert.equal(result.quality.omittedBars,1);assert.equal(result.provenance.sessionValidated,true);
  assert.equal(result.provenance.historyMode,'canonical-provider-snapshot');
});

test('Nasdaq rejects absent or malformed historical sessions instead of inventing market hours',()=>{
  for(const sessions of [undefined,[],[[{start:1,end:1}]],[[{start:'1',end:2}]],[[{start:1,end:NaN}]]]){
    const payload=yahoo();payload.chart.result[0].meta.tradingPeriods=sessions;
    assert.throws(()=>normalizeProviderImport(envelope(payload),now),/Sessions Nasdaq/);
  }
  const payload=yahoo();payload.chart.result[0].meta.tradingPeriods={regular:payload.chart.result[0].meta.tradingPeriods};
  assert.equal(normalizeProviderImport(envelope(payload),now).bars.length,100);
});

test('an ETF or wrong provider symbol cannot silently replace Nasdaq, forex, or gold spot',()=>{
  assert.throws(()=>normalizeProviderImport(envelope(yahoo('QQQ','ETF')),now),/substitution refusée/);
  assert.throws(()=>normalizeProviderImport(envelope(yahoo('^NDX','ETF')),now),/substitution refusée/);
  assert.throws(()=>normalizeProviderImport(envelope(yahoo('GBPUSD=X','CURRENCY'),'Yahoo Finance','EUR/USD'),now),/substitution refusée/);
  assert.throws(()=>normalizeProviderImport(envelope({...twelve(),meta:{...twelve().meta,symbol:'GC=F'}},'Twelve Data','XAU/USD'),now),/substitution refusée/);
});

test('Twelve gold spot import sorts real bars, preserves observed quote time and identifies unavailable volume',()=>{
  const quote={symbol:'XAU/USD',close:'2501',timestamp:(now-30000)/1000,is_market_open:true};
  const result=normalizeProviderImport(envelope(twelve(),'Twelve Data','XAU/USD',quote),now);
  assert.equal(result.bars.length,100);assert.equal(result.bars[0].time,new Date(begin-100*900000).toISOString());
  assert.equal(result.quote.price,2501);assert.equal(result.quote.receivedAt,new Date(now-30000).toISOString());
  assert.equal(result.live,false);assert.equal(result.provenance.providerSymbol,'XAU/USD');assert.equal(result.quality.volumeAvailable,false);
  assert.ok(result.bars.every(bar=>bar.volume===0));
});

test('missing OHLC is omitted without interpolation; malformed, duplicate, future, short and ambiguous timezone imports are refused',()=>{
  const payload=yahoo();payload.chart.result[0].indicators.quote[0].open[20]=null;
  const result=normalizeProviderImport(envelope(payload),now);assert.equal(result.bars.length,99);assert.equal(result.quality.omittedBars,1);
  const duplicate=yahoo();duplicate.chart.result[0].timestamp[20]=duplicate.chart.result[0].timestamp[19];assert.throws(()=>normalizeProviderImport(envelope(duplicate),now),/Bougies invalides/);
  const invalid=twelve();invalid.values[10].high='2400';assert.throws(()=>normalizeProviderImport(envelope(invalid,'Twelve Data','XAU/USD'),now),/Bougies invalides/);
  const short=twelve();short.values=short.values.slice(0,10);assert.throws(()=>normalizeProviderImport(envelope(short,'Twelve Data','XAU/USD'),now),/60 bougies/);
  const timezone=twelve();delete timezone.meta.exchange_timezone;assert.throws(()=>normalizeProviderImport(envelope(timezone,'Twelve Data','XAU/USD'),now),/Fuseau fournisseur/);
  assert.throws(()=>normalizeProviderImport({...envelope(twelve(),'Twelve Data','XAU/USD'),fetchedAt:new Date(now+120000).toISOString()},now),/Import futur/);
});

test('provider local timestamps use IANA daylight-saving transitions and never the computer timezone',()=>{
  assert.equal(providerTimeToUTC('2026-10-04 01:45:00','Australia/Sydney'),'2026-10-03T15:45:00.000Z');
  assert.equal(providerTimeToUTC('2026-10-04 03:00:00','Australia/Sydney'),'2026-10-03T16:00:00.000Z');
  assert.equal(providerTimeToUTC('2026-10-03 12:00:00','Australia/Sydney'),'2026-10-03T02:00:00.000Z');
  assert.equal(providerTimeToUTC('2026-10-05 12:00:00','Australia/Sydney'),'2026-10-05T01:00:00.000Z');
  assert.throws(()=>providerTimeToUTC('2026-10-04 02:15:00','Australia/Sydney'),/inexistante/);
  assert.throws(()=>providerTimeToUTC('2026-04-05 02:15:00','Australia/Sydney'),/ambiguë/);
  assert.throws(()=>providerTimeToUTC('2026-10-08 11:00:00'),/explicite requis/);
  assert.equal(providerTimeToUTC('2026-10-08T11:00:00Z'), '2026-10-08T11:00:00.000Z');
});

test('public Yahoo fetch uses the exact index identifier, rejects errors and exposes no claim of streaming data',async()=>{
  let seen;
  const result=await fetchYahooSnapshot('NDX',{now:()=>now,fetchImpl:async(url,options)=>{seen={url,options};return {ok:true,json:async()=>yahoo()};}});
  assert.match(seen.url,/%5ENDX\?interval=15m&range=1mo$/);assert.equal(result.live,false);assert.equal(result.provenance.endpointKind,'public-unofficial');
  await assert.rejects(fetchYahooSnapshot('NDX',{fetchImpl:async()=>({ok:false,status:429})}),/HTTP 429/);
  await assert.rejects(fetchYahooSnapshot('XAU/USD',{fetchImpl:async()=>{throw Error('Must not fetch a substitute');}}),/absent du fournisseur/);
});

test('file imports enforce the same provider validation and retain their original fetch time',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'orivane-import-test-')),filename=path.join(directory,'gold.json');
  try{writeFileSync(filename,JSON.stringify(envelope(twelve(),'Twelve Data','XAU/USD')));const result=loadProviderImport(filename,now);assert.equal(result.receivedAt,fetchedAt);assert.equal(result.quote,null);}
  finally{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'orivane-import-test-'));rmSync(directory,{recursive:true,force:true});}
});
