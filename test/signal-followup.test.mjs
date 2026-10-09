import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SignalFollowup} from '../src/signal-followup.mjs';

const baseline=Date.parse('2026-10-08T12:15:10.000Z');
const iso=value=>new Date(value).toISOString();
function fixture(overrides={}) {
  return {mode:'observed-live',policy:'confidence-above-60-v1',confidencePercent:80,
    symbol:'BTC/USD',source:'Kraken public · spot',strategy:'pullback',strategyName:'Pullback',side:'BUY',
    observedAt:iso(baseline),signalTime:'2026-10-08T12:00:00.000Z',referenceTime:'2026-10-08T12:15:00.000Z',horizonEndAt:'2026-10-08T13:15:00.000Z',
    entry:100,stop:95,target:110,...overrides};
}
function harness() {
  const db=new DatabaseSync(':memory:');let clock=baseline;
  return {db,tracker:new SignalFollowup(db,{now:()=>clock}),advance:ms=>clock+=ms,close:()=>db.close()};
}
function quote(price,at,overrides={}) {
  return {symbol:'BTC/USD',source:'Kraken public · spot',fresh:true,
    quote:{price,receivedAt:iso(at),localReceivedAt:iso(at),transport:'websocket'},...overrides};
}

test('registers one new signal with immutable levels and no invented result',()=>{
  const h=harness();try {
    const input=fixture();assert.equal(h.tracker.record('signal-1',input),true);
    input.target=500;input.confidencePercent=99;
    assert.equal(h.tracker.record('signal-1',fixture({target:200})),false);
    const result=h.tracker.snapshot();assert.equal(result.mode,'observed-levels');
    assert.deepEqual(result.summary,{watching:1,targetObserved:0,stopObserved:0,expired:0,total:1});
    assert.equal(result.items[0].target,110);assert.equal(result.items[0].confidencePercent,80);
    assert.equal(result.items[0].createdAt,iso(baseline));assert.equal(result.items[0].signalObservedAt,iso(baseline));
    assert.equal(result.items[0].observedPrice,null);assert.equal(result.items[0].observedAt,null);
    assert.equal(result.items[0].lastQuoteAt,null);assert.equal(result.items[0].status,'watching');
    assert.equal('winRate' in result,false);assert.equal('pnl' in result.items[0],false);
  } finally {h.close();}
});

test('rejects non-live, low-confidence, malformed, old, future and unanchored signals',()=>{
  const h=harness();try {
    const invalid=[{mode:'backtest'},{mode:'paper'},{policy:'other'},{side:'HOLD'},
      {confidencePercent:60},{confidencePercent:7},{confidencePercent:100.1},{confidencePercent:NaN},
      {confidencePercent:'90'},{confidenceClass:'DOWN'},{confidenceClass:'FLAT'},{entry:0},{entry:Infinity},{stop:100},{target:100},{stop:101},{target:99},
      {symbol:''},{source:''},{observedAt:'bad'},{signalTime:'bad'},{referenceTime:'bad'},{horizonEndAt:'bad'},
      {observedAt:iso(baseline+1)},{observedAt:iso(baseline-120001)},
      {signalTime:'2026-10-08T12:30:00.000Z'},
      {referenceTime:'2026-10-08T12:15:11.000Z'},
      {referenceTime:'2026-10-08T12:14:59.000Z'},
      {horizonEndAt:'2026-10-08T13:15:01.000Z'},
      {observedAt:iso(baseline-120001),signalTime:'2026-10-08T11:00:00.000Z',referenceTime:'2026-10-08T11:15:00.000Z',horizonEndAt:'2026-10-08T12:15:00.000Z'}];
    invalid.forEach((patch,index)=>assert.equal(h.tracker.record('bad-'+index,fixture(patch)),false,JSON.stringify(patch)));
    assert.equal(h.tracker.record('',fixture()),false);assert.equal(h.tracker.record(null,fixture()),false);
    assert.equal(h.tracker.record('null',null),false);assert.equal(h.tracker.snapshot().summary.total,0);
    assert.equal(h.tracker.record('valid-60.1',fixture({confidencePercent:60.1})),true);
    assert.equal(h.tracker.record('valid-100',fixture({confidencePercent:100})),true);
  } finally {h.close();}
});

test('records exact first BUY and SELL target / stop boundaries from later real quotes',()=>{
  for(const [side,price,status] of [['BUY',110,'target-observed'],['BUY',95,'stop-observed'],['SELL',90,'target-observed'],['SELL',105,'stop-observed']]) {
    const h=harness();try {
      h.tracker.record('observed',fixture(side==='SELL'?{side,stop:105,target:90}:{}));
      const first=h.advance(1000);assert.equal(h.tracker.observe(quote(price,first),first),1);
      const item=h.tracker.snapshot().items[0];assert.equal(item.status,status);
      assert.equal(item.observedPrice,price);assert.equal(item.observedAt,iso(first));
      assert.equal(item.lastQuoteAt,iso(first));assert.equal(item.lastObservationAt,iso(first));
      const next=h.advance(1000);assert.equal(h.tracker.observe(quote(side==='BUY'?1:1000,next),next),0);
      assert.deepEqual(h.tracker.snapshot().items[0],item,'The later quote must not overwrite the first observed crossing');
    } finally {h.close();}
  }
});

test('honours symbol/source, explicit freshness and transport timestamps before crossing',()=>{
  const invalid=[
    (at)=>quote(111,at,{fresh:false}),
    (at)=>quote(111,at,{fresh:1}),
    (at)=>quote(111,at,{symbol:'ETH/USD'}),
    (at)=>quote(111,at,{source:'Another provider'}),
    (at)=>quote(111,at,{quote:{price:0,receivedAt:iso(at),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:NaN,receivedAt:iso(at),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:'111',receivedAt:iso(at),transport:'websocket'}}),
    ()=>quote(111,baseline),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:'bad',transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at+1),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at-30000),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at-120000),transport:'rest'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at),localReceivedAt:'bad',transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at),localReceivedAt:iso(at+1),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at),localReceivedAt:iso(at-1),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at),eventTime:iso(baseline),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at-1),eventTime:iso(at),transport:'websocket'}}),
    (at)=>quote(111,at,{quote:{price:111,receivedAt:iso(at),transport:'unknown'}}),
  ];
  const h=harness();try {
    h.tracker.record('guarded',fixture());const at=h.advance(150000);
    for(const makeInvalid of invalid)assert.equal(h.tracker.observe(makeInvalid(at),at),0);
    assert.equal(h.tracker.observe(null,at),0);assert.equal(h.tracker.observe(quote(111,at),NaN),0);
    assert.equal(h.tracker.snapshot().items[0].status,'watching');
    assert.equal(h.tracker.snapshot().items[0].lastQuoteAt,null);
    assert.equal(h.tracker.observe(quote(111,at),at),1);
  } finally {h.close();}
});

test('rejects repeated, backwards quotes and backwards observations while preserving original levels',()=>{
  const h=harness();try {
    h.tracker.record('ordered',fixture());const first=h.advance(2000);
    assert.equal(h.tracker.observe(quote(102,first),first),1);
    assert.equal(h.tracker.observe(quote(110,first),first+1000),0);
    assert.equal(h.tracker.observe(quote(110,first-1),first+1000),0);
    assert.equal(h.tracker.observe(quote(110,first+500),first-1),0);
    const next=h.advance(2000);assert.equal(h.tracker.observe(quote(111,next),next),1);
    const item=h.tracker.snapshot().items[0];assert.equal(item.observedPrice,111);
    assert.equal(item.observedAt,iso(next));assert.deepEqual([item.entry,item.stop,item.target],[100,95,110]);
  } finally {h.close();}
});

test('outage recovery reports first observed quote without inventing touches between observations',()=>{
  const h=harness();try {
    h.tracker.record('gap',fixture());const before=h.advance(1000);
    h.tracker.observe(quote(102,before),before);
    const after=h.advance(20*60000);assert.equal(h.tracker.observe(quote(113,after,{fresh:false}),after),0);
    assert.equal(h.tracker.snapshot().items[0].observedPrice,null);
    const resumed=h.advance(1000);h.tracker.observe(quote(112,resumed),resumed);
    const item=h.tracker.snapshot().items[0];assert.equal(item.status,'target-observed');
    assert.equal(item.observedPrice,112);assert.equal(item.observedAt,iso(resumed));
    assert.equal('touchTime' in item,false);assert.equal('interpolated' in item,false);
  } finally {h.close();}
});

test('distinct same-provider-second ticks use actual increasing local receipts without accepting replays',()=>{
  const h=harness();try {
    h.tracker.record('fine-order',fixture());const providerAt=h.advance(1000);
    h.tracker.observe(quote(102,providerAt),providerAt);
    const later=h.advance(10);
    const fineQuote=(price,localAt)=>quote(price,providerAt,{quote:{price,receivedAt:iso(providerAt),eventTime:iso(providerAt),localReceivedAt:iso(localAt),transport:'websocket'}});
    assert.equal(h.tracker.observe(fineQuote(111,providerAt),later),0,'Identical receipt cannot safely order a changed price');
    assert.equal(h.tracker.observe(fineQuote(102,later),later),0,'Same provider tick and same quote remains a duplicate');
    assert.equal(h.tracker.observe(fineQuote(111,later),later),1);
    const item=h.tracker.snapshot().items[0];assert.equal(item.status,'target-observed');assert.equal(item.observedPrice,111);
    assert.equal(item.lastQuoteAt,iso(providerAt));assert.equal(item.observedAt,iso(later));
    const reversal=h.advance(10);assert.equal(h.tracker.observe(fineQuote(102,reversal),reversal),0);
    assert.deepEqual(h.tracker.snapshot().items[0],item);
  } finally {h.close();}
});

test('accepts genuine REST/import freshness inside the transport budget and ignores all OHLC fields',()=>{
  for(const transport of ['rest','import']) {
    const h=harness();try {
      h.tracker.record('snapshot',fixture());const received=baseline+1000,at=h.advance(120999);
      const update=quote(102,received,{quote:{price:102,receivedAt:iso(received),transport},bars:[{high:120,low:90}],currentBar:{high:120,low:90}});
      assert.equal(h.tracker.observe(update,at),1);assert.equal(h.tracker.snapshot().items[0].status,'watching');
      assert.equal(h.tracker.snapshot().items[0].observedPrice,null);
      const next=h.advance(1000);h.tracker.observe(quote(112,next,{quote:{price:112,receivedAt:iso(next),transport}}),next);
      assert.equal(h.tracker.snapshot().items[0].status,'target-observed');
    } finally {h.close();}
  }
});

test('expires exactly at the anchored horizon without attributing late prices or OHLC backfill',()=>{
  const h=harness();try {
    const horizon=Date.parse(fixture().horizonEndAt);h.tracker.record('expired',fixture());
    assert.equal(h.tracker.expire(horizon-1),0);assert.equal(h.tracker.expire(horizon),1);
    let item=h.tracker.snapshot().items[0];assert.equal(item.status,'expired');assert.equal(item.observedAt,null);assert.equal(item.observedPrice,null);
    assert.equal(item.expiresAt,iso(horizon));assert.equal(h.tracker.expire(horizon+1),0);
    assert.equal(h.tracker.observe(quote(110,horizon+1000),horizon+1000),0);
    assert.deepEqual(h.tracker.snapshot().items[0],item);
    assert.deepEqual(h.tracker.snapshot().summary,{watching:0,targetObserved:0,stopObserved:0,expired:1,total:1});
    h.tracker.record('late',fixture());
    assert.equal(h.tracker.observe({...quote(111,horizon-1),bars:[{high:120,low:90}]},horizon+1000),1);
    item=h.tracker.snapshot().items.find(row=>row.id==='late');assert.equal(item.status,'expired');assert.equal(item.observedPrice,null);
  } finally {h.close();}
});

test('snapshot filters, limits and summaries use real stored rows, with no result-rate field',()=>{
  const h=harness();try {
    h.tracker.record('btc',fixture());h.tracker.record('gold',fixture({symbol:'XAU/USD',source:'Deriv public'}));
    const at=h.advance(1000);h.tracker.observe(quote(111,at),at);
    const btc=h.tracker.snapshot({symbol:'BTC/USD',limit:1});assert.equal(btc.items.length,1);assert.equal(btc.items[0].id,'btc');
    assert.deepEqual(btc.summary,{watching:0,targetObserved:1,stopObserved:0,expired:0,total:1});
    assert.equal(h.tracker.snapshot({limit:1}).items.length,1);assert.equal(h.tracker.snapshot({limit:1}).summary.total,2);
    assert.equal(h.tracker.snapshot({symbol:'UNKNOWN'}).summary.total,0);
    assert.equal('winRate' in btc.summary,false);
  } finally {h.close();}
});

test('SQLite restart preserves immutable snapshots, ordering guards and outcomes without deriving old events',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'orivane-followup-')),dbPath=path.join(directory,'followup.sqlite');
  let db;try {
    db=new DatabaseSync(dbPath);db.exec('CREATE TABLE events (id TEXT PRIMARY KEY,time TEXT,payload TEXT)');
    db.prepare('INSERT INTO events VALUES (?,?,?)').run('legacy',iso(baseline),JSON.stringify(fixture()));
    let tracker=new SignalFollowup(db,{now:()=>baseline});assert.equal(tracker.snapshot().summary.total,0);
    tracker.record('persisted',fixture());tracker.observe(quote(102,baseline+1000),baseline+1000);
    db.close();db=new DatabaseSync(dbPath);tracker=new SignalFollowup(db,{now:()=>baseline+2000});
    assert.equal(tracker.record('persisted',fixture({target:999})),false);
    assert.equal(tracker.observe(quote(111,baseline+1000),baseline+2000),0);
    assert.equal(tracker.observe(quote(111,baseline+2000),baseline+2000),1);
    const stored=tracker.snapshot();db.close();db=new DatabaseSync(dbPath);
    tracker=new SignalFollowup(db,{now:()=>baseline+3000});assert.deepEqual(tracker.snapshot(),stored);
    assert.equal(tracker.snapshot().items[0].target,110);assert.equal(tracker.snapshot().summary.targetObserved,1);
  } finally {
    db?.close();
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    assert.match(path.basename(directory),/^orivane-followup-/);
    rmSync(directory,{recursive:true,force:true});
  }
});
