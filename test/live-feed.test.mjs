import test from 'node:test';
import assert from 'node:assert/strict';
import {KrakenLiveFeed} from '../src/live-feed.mjs';

const start=Date.parse('2026-10-08T12:00:00Z');
const candle=(time=start,overrides={})=>({symbol:'BTC/USD',interval:15,interval_begin:new Date(time).toISOString(),open:100,high:103,low:99,close:102,volume:10,trades:3,...overrides});
const oh=(...data)=>({channel:'ohlc',type:'update',data});
const trade=(id,time,price=102)=>({channel:'trade',type:'update',data:[{symbol:'BTC/USD',trade_id:id,timestamp:new Date(time).toISOString(),price,qty:1}]});

test('OHLC updates remain forming until rollover; duplicates and old intervals cannot regress a candle',()=>{
  let now=start+120000;const closed=[],updates=[];
  const feed=new KrakenLiveFeed({now:()=>now,onClosedBar:(symbol,bar)=>closed.push({symbol,bar}),onUpdate:event=>updates.push(event)});
  feed.seed('BTC/USD',{bars:[{time:new Date(start-900000).toISOString()}]});
  assert.equal(feed.ingest(oh(candle())),true);assert.equal(closed.length,0);
  assert.equal(feed.snapshot('BTC/USD').currentBar.closed,false);
  assert.equal(feed.ingest(oh(candle(start,{close:103,volume:11,trades:4}))),true);
  assert.equal(feed.ingest(oh(candle())),false);
  assert.equal(feed.ingest(oh(candle(start-900000))),false);
  assert.equal(feed.snapshot('BTC/USD').currentBar.close,103);
  now=start+900001;
  feed.ingest(oh(candle(start+900000,{open:104,close:104,high:104,low:104,volume:1,trades:1})));
  assert.equal(closed.length,1);assert.equal(closed[0].bar.time,new Date(start).toISOString());
  assert.equal(closed[0].bar.close,103);assert.equal(closed[0].bar.closed,true);
  feed.ingest(oh(candle(start+900000,{open:104,close:104,high:104,low:104,volume:1,trades:1})));
  assert.equal(closed.length,1);assert.equal(updates.length,3);
});

test('quote timestamps come from real trade events, with per-book IDs rejecting duplicates and out-of-order data',()=>{
  let now=start+10000;const feed=new KrakenLiveFeed({now:()=>now});
  feed.ingest(trade(100,start+9000));
  assert.equal(feed.snapshot('BTC/USD').quote.price,102);
  assert.equal(feed.snapshot('BTC/USD').quote.receivedAt,'2026-10-08T12:00:09.000Z');
  assert.equal(feed.ingest(trade(100,start+9500,999)),false);
  assert.equal(feed.ingest(trade(101,start+8000,999)),false);
  assert.equal(feed.ingest(trade(102,start+100000,999)),false);
  now+=1000;feed.ingest({channel:'heartbeat'});
  assert.equal(feed.snapshot('BTC/USD').quote.price,102);
  assert.equal(feed.snapshot('BTC/USD').ageMs,2000);
  now=start+41000;feed.ingest({channel:'heartbeat'});
  assert.equal(feed.snapshot().status,'live');assert.equal(feed.snapshot('BTC/USD').status,'stale');
  assert.equal(feed.snapshot('BTC/USD').quote.receivedAt,'2026-10-08T12:00:09.000Z');
});

test('invalid OHLC input is rejected and missing intervals are never synthesized',()=>{
  let now=start+1;const closed=[];const feed=new KrakenLiveFeed({now:()=>now,onClosedBar:(symbol,bar)=>closed.push(bar)});
  for(const value of [{close:0},{high:90},{volume:-1},{interval:1},{interval_begin:'invalid'}])assert.equal(feed.ingest(oh(candle(start,value))),false);
  assert.equal(feed.ingest('{invalid'),false);assert.equal(feed.snapshot('BTC/USD').currentBar,null);
  feed.ingest(oh(candle()));now=start+1800001;feed.ingest(oh(candle(start+1800000)));
  assert.equal(closed.length,1);assert.equal(closed[0].time,new Date(start).toISOString());
});

test('a disconnected partial candle is not promoted into confirmed history on reconnect rollover',()=>{
  let now=start+1;const closed=[];const feed=new KrakenLiveFeed({now:()=>now,onClosedBar:(symbol,bar)=>closed.push(bar),
    setTimer:()=>({unref(){}}),clearTimer:()=>{}});
  feed.ingest(oh(candle()));feed.stopped=false;feed.reconnect('Test interruption');
  now=start+900001;feed.ingest(oh(candle(start+900000)));
  assert.equal(closed.length,0);assert.equal(feed.snapshot('BTC/USD').currentBar.time,new Date(start+900000).toISOString());
  feed.stop();
});

test('silent sockets reconnect, detach obsolete listeners and stop cancels every reconnect/check timer',()=>{
  let now=start;const sockets=[],timers=[],repeaters=[];
  class Socket {
    constructor(url){assert.equal(url,'wss://ws.kraken.com/v2');this.handlers=new Map();this.sent=[];this.readyState=0;sockets.push(this);}
    addEventListener(type,handler){this.handlers.set(type,handler);}
    removeEventListener(type,handler){if(this.handlers.get(type)===handler)this.handlers.delete(type);}
    send(data){this.sent.push(JSON.parse(data));}
    close(){this.readyState=3;}
    emit(type,data){if(type==='open')this.readyState=1;this.handlers.get(type)?.({data});}
  }
  const handle=fn=>({fn,cancelled:false,unref(){}}),cancel=timer=>{timer.cancelled=true;};
  const feed=new KrakenLiveFeed({now:()=>now,WebSocketImpl:Socket,
    setTimer:fn=>{const t=handle(fn);timers.push(t);return t;},clearTimer:cancel,
    setRepeater:fn=>{const t=handle(fn);repeaters.push(t);return t;},clearRepeater:cancel});
  feed.start();assert.equal(sockets.length,1);sockets[0].emit('open');
  assert.deepEqual(sockets[0].sent.map(s=>s.params.channel),['ohlc','trade']);
  assert.equal(sockets[0].sent[0].params.interval,15);
  sockets[0].emit('message',JSON.stringify({channel:'heartbeat'}));assert.equal(feed.snapshot().status,'live');
  now+=16000;feed.check();assert.equal(feed.snapshot().status,'stale');assert.equal(feed.snapshot().reconnects,1);
  assert.equal(sockets[0].handlers.size,0);assert.equal(sockets[0].readyState,3);
  timers[0].fn();assert.equal(sockets.length,2);assert.equal(feed.snapshot().status,'reconnecting');
  sockets[1].emit('open');sockets[1].emit('error');assert.equal(timers.length,2);
  feed.stop();assert.equal(timers[1].cancelled,true);assert.equal(repeaters[0].cancelled,true);
  assert.equal(sockets[1].handlers.size,0);assert.equal(feed.snapshot().status,'offline');
  timers[1].fn();assert.equal(sockets.length,2);
});
