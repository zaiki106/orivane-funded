import test from 'node:test';
import assert from 'node:assert/strict';
import {DerivLiveFeed,DERIV_SOURCE} from '../src/deriv-feed.mjs';
const start=Date.parse('2026-10-08T12:00:00Z'),seconds=t=>t/1000;
const active={msg_type:'active_symbols',active_symbols:[{underlying_symbol:'frxEURUSD',market:'forex',submarket:'major_pairs',underlying_symbol_type:'forex',exchange_is_open:1,is_trading_suspended:0}]};
const candle=(time=start,overrides={})=>({epoch:seconds(time),open:1.11,high:1.12,low:1.10,close:1.115,...overrides});
const ohlc=(time=start,event=start+1000,overrides={})=>({msg_type:'ohlc',ohlc:{...candle(time),open_time:seconds(time),epoch:seconds(event),granularity:900,symbol:'frxEURUSD',...overrides}});
const tick=(event=start+1000,overrides={})=>({msg_type:'tick',tick:{epoch:seconds(event),symbol:'frxEURUSD',quote:1.115,bid:1.1149,ask:1.1151,...overrides}});
test('Deriv verifies real market classification before subscribing; synthetic substitutions are refused',()=>{
  assert.throws(()=>new DerivLiveFeed({symbols:['R_100']}));const sent=[],feed=new DerivLiveFeed({symbols:['EUR/USD'],now:()=>start+1000});
  feed.socket={readyState:1,send:raw=>sent.push(JSON.parse(raw))};
  assert.equal(feed.ingest(tick()),false);
  feed.ingest({...active,active_symbols:[{...active.active_symbols[0],market:'synthetic_index'}]});assert.equal(sent.length,0);assert.equal(feed.ingest(tick()),false);
  feed.ingest(active);assert.equal(sent.length,2);assert.equal(sent[0].ticks_history,'frxEURUSD');assert.equal(sent[0].subscribe,1);assert.equal(sent[0].granularity,900);assert.equal(sent[1].ticks,'frxEURUSD');
});
test('Deriv history excludes nonaligned partial first candle, open candle and gaps; volume is unavailable',()=>{
  const histories=[],feed=new DerivLiveFeed({symbols:['EUR/USD'],now:()=>start+1000,onHistory:d=>histories.push(d)});feed.ingest(active);
  feed.ingest({msg_type:'candles',echo_req:{ticks_history:'frxEURUSD'},candles:[candle(start-1800000+75000),candle(start-900000),candle()]});
  assert.equal(histories.length,1);assert.equal(histories[0].bars.length,1);assert.equal(histories[0].bars[0].time,'2026-10-08T11:45:00.000Z');
  assert.equal(histories[0].currentBar.closed,false);assert.equal(histories[0].bars[0].volume,0);assert.equal(histories[0].volumeUnavailable,true);assert.equal(histories[0].source,DERIV_SOURCE);
});
test('Deriv quotes retain provider timestamps and spreads, reject invalid/old events, and become stale without fake ticks',()=>{
  let now=start+2000;const feed=new DerivLiveFeed({symbols:['EUR/USD'],now:()=>now});feed.ingest(active);assert.equal(feed.ingest(tick()),true);
  assert.equal(feed.snapshot('EUR/USD').quote.receivedAt,'2026-10-08T12:00:01.000Z');assert.equal(feed.snapshot('EUR/USD').quote.bid,1.1149);
  assert.equal(feed.ingest(tick()),false);assert.equal(feed.ingest(tick(start,{quote:99})),false);assert.equal(feed.ingest(tick(start+60000)),false);assert.equal(feed.ingest(tick(start+2000,{quote:0})),false);
  now=start+20000;feed.ingest({msg_type:'ping'});assert.equal(feed.snapshot('EUR/USD').status,'stale');assert.equal(feed.snapshot('EUR/USD').quote.price,1.115);
});
test('Deriv confirmed history only advances on validated OHLC rollover; reconnect partial candle is excluded',()=>{
  let now=start+1000;const closed=[],feed=new DerivLiveFeed({symbols:['EUR/USD'],now:()=>now,onClosedBar:(s,b)=>closed.push(b),setTimer:()=>({unref(){}}),clearTimer:()=>{}});feed.ingest(active);feed.ingest(ohlc());
  assert.equal(feed.ingest(ohlc(start,start,{close:1.111})),false);assert.equal(closed.length,0);
  now=start+900001;feed.ingest(ohlc(start+900000,start+900000));assert.equal(closed.length,1);assert.equal(closed[0].closed,true);assert.equal(closed[0].time,'2026-10-08T12:00:00.000Z');
  feed.stopped=false;feed.reconnect('test');feed.ingest(active);now=start+1800001;feed.ingest(ohlc(start+1800000,start+1800000));assert.equal(closed.length,1);feed.stop();
});
test('Deriv stop removes socket handlers and cancels retry and heartbeat timers',()=>{
  const sockets=[],timers=[],repeaters=[];let now=start;
  class Socket{constructor(){this.readyState=0;this.handlers=new Map();sockets.push(this);}addEventListener(t,h){this.handlers.set(t,h);}removeEventListener(t,h){if(this.handlers.get(t)===h)this.handlers.delete(t);}send(){}close(){this.readyState=3;}emit(t,d){if(t==='open')this.readyState=1;this.handlers.get(t)?.({data:d});}}
  const handle=fn=>({fn,cancelled:false,unref(){}}),cancel=h=>h.cancelled=true;
  const feed=new DerivLiveFeed({symbols:['EUR/USD'],now:()=>now,WebSocketImpl:Socket,setTimer:fn=>{const h=handle(fn);timers.push(h);return h;},clearTimer:cancel,setRepeater:fn=>{const h=handle(fn);repeaters.push(h);return h;},clearRepeater:cancel});
  feed.start();sockets[0].emit('open');now+=31000;feed.check();assert.equal(feed.snapshot().status,'stale');assert.equal(sockets[0].handlers.size,0);feed.stop();assert.equal(timers[0].cancelled,true);assert.equal(repeaters[0].cancelled,true);timers[0].fn();assert.equal(sockets.length,1);
});
