import test from 'node:test';
import assert from 'node:assert/strict';
import {marketHealth} from '../src/market-health.mjs';

const interval=900000,now=Date.parse('2026-10-08T12:07:30Z');
const iso=time=>new Date(time).toISOString();
const bar=(time,extra={})=>({time:iso(time),open:100,high:102,low:99,close:101,volume:2,closed:true,...extra});
function market(extra={}){
  return {symbol:'EUR/USD',source:'Real provider',timeframe:15,live:true,
    feed:{status:'live',transport:'websocket'},
    quote:{price:100,bid:99,ask:101,eventTime:iso(now-2000),receivedAt:iso(now-2000),localReceivedAt:iso(now-1000),transport:'websocket'},
    bars:[bar(now-450000-interval*3),bar(now-450000-interval*2),bar(now-450000-interval)],
    currentBar:bar(now-450000,{closed:false}),
    model:{status:'ready',source:'Real provider',trainedAt:iso(now-60000)},...extra};
}

test('reports receipt age, provider-event age, actual spread and candle timings independently',()=>{
  const report=marketHealth(market(),{now});
  assert.equal(report.symbol,'EUR/USD');assert.equal(report.source,'Real provider');assert.equal(report.state,'live');assert.equal(report.transport,'websocket');
  assert.equal(report.quoteAt,iso(now-1000));assert.equal(report.quoteAgeMs,1000);
  assert.equal(report.quoteEventAt,iso(now-2000));assert.equal(report.quoteEventAgeMs,2000);
  assert.equal(report.spread,2);assert.equal(report.spreadBps,200);
  assert.equal(report.lastClosedAt,iso(now-450000));assert.equal(report.closedAgeMs,450000);
  assert.equal(report.barCount,3);assert.equal(report.consecutiveClosedBars,3);
  assert.equal(report.formingBarProgressPct,50);assert.equal(report.modelStatus,'ready');assert.equal(report.modelAgeMs,60000);
  assert.equal(Object.hasOwn(report,'latencyMs'),false,'Receipt and market-event age are not a measured network latency');
});

test('explicit valid provider expiry controls freshness and expires exactly at its deadline',()=>{
  const row=market({staleAt:iso(now+1000)});
  assert.equal(marketHealth(row,{now}).state,'live');
  assert.equal(marketHealth(row,{now:now+1000}).state,'stale');
  assert.equal(marketHealth(market({staleAt:iso(now-1)}),{now}).state,'stale');
  const delayed=market({staleAt:iso(now+1000)});delayed.quote.eventTime=iso(now-31000);delayed.quote.receivedAt=delayed.quote.eventTime;
  assert.equal(marketHealth(delayed,{now}).state,'stale','A fresh local receipt cannot disguise an already old provider event');
});

test('transport fallback budgets are thirty seconds for WebSocket and two minutes for REST snapshots',()=>{
  for(const [transport,budget,state] of [['websocket',30000,'live'],['rest',120000,'snapshot']]){
    const row=market({live:transport==='websocket',feed:{status:state,transport}});
    row.quote={price:100,receivedAt:iso(now-budget+1),transport};
    if(transport==='websocket')row.quote.localReceivedAt=row.quote.receivedAt;
    assert.equal(marketHealth(row,{now}).state,state);
    assert.equal(marketHealth(row,{now:now+1}).state,'stale');
    row.staleAt='invalid';assert.equal(marketHealth(row,{now:now+1}).state,'stale');
  }
});

test('imports distinguish the actual local capture from the provider market timestamp',()=>{
  const row=market({symbol:'NDX',live:false,feed:{status:'snapshot',transport:'import'},
    quote:{price:25000,receivedAt:iso(now-10000),eventTime:iso(now-10000),capturedAt:iso(now-2500),transport:'import'}});
  const report=marketHealth(row,{now});
  assert.equal(report.state,'snapshot');assert.equal(report.quoteAgeMs,2500);assert.equal(report.quoteEventAgeMs,10000);
  assert.equal(report.spread,null);assert.equal(report.spreadBps,null);
  row.live=true;assert.equal(marketHealth(row,{now}).state,'snapshot','A provider snapshot is never upgraded to live');
  row.provenance={marketOpen:false};assert.equal(marketHealth(row,{now}).state,'closed');
});

test('authoritative unavailable, closed, interrupted and historical feeds are not resurrected by a fresh quote',()=>{
  for(const state of ['unavailable','closed','offline','connecting','error','stale','historical']){
    assert.equal(marketHealth(market({feed:{status:state,transport:'websocket'}}),{now}).state,state,state);
  }
  const noLive=market({live:false});assert.equal(marketHealth(noLive,{now}).state,'stale','A stream rejected as live by the radar cannot be relabelled as a provider snapshot');
  assert.equal(marketHealth(market({feed:{status:'undocumented',transport:'websocket'}}),{now}).state,'unavailable');
});

test('missing or future receipt clocks never produce a negative or invented local age',()=>{
  for(const localReceivedAt of [undefined,null,'bad-date',iso(now+1)]){
    const row=market();row.quote.localReceivedAt=localReceivedAt;
    const report=marketHealth(row,{now});
    assert.equal(report.quoteAt,null);assert.equal(report.quoteAgeMs,null);assert.equal(report.state,'unavailable');
  }
  const rest=market({live:false,feed:{status:'snapshot',transport:'rest'},quote:{price:100,receivedAt:iso(now-500),transport:'rest'}});
  assert.equal(marketHealth(rest,{now}).quoteAgeMs,500);
  rest.quote.receivedAt=iso(now+1);assert.equal(marketHealth(rest,{now}).quoteAgeMs,null);assert.equal(marketHealth(rest,{now}).state,'unavailable');
});

test('future or malformed provider timestamps fail closed even when the local receive clock is current',()=>{
  for(const eventTime of [iso(now+1),'invalid']){
    const row=market();row.quote.eventTime=eventTime;
    const report=marketHealth(row,{now});assert.equal(report.state,'unavailable');assert.equal(report.quoteEventAt,null);assert.equal(report.quoteEventAgeMs,null);
    assert.equal(report.quoteAgeMs,1000);
  }
  const old=market();old.quote.eventTime=iso(now-60000);old.quote.receivedAt=old.quote.eventTime;
  assert.equal(marketHealth(old,{now}).state,'stale');
});

test('missing books remain unknown and malformed prices or books cannot be labelled live',()=>{
  for(const quote of [null,{}, {price:0},{price:-1},{price:NaN},{price:Infinity},{price:'100'}]){
    const row=market();row.quote=quote;
    const report=marketHealth(row,{now});assert.equal(report.state,'unavailable');assert.equal(report.spread,null);assert.equal(report.spreadBps,null);
  }
  for(const [bid,ask] of [[null,null],[undefined,undefined],[99,null],[null,101]]){
    const row=market();row.quote.bid=bid;row.quote.ask=ask;
    const report=marketHealth(row,{now});assert.equal(report.spread,null);assert.equal(report.spreadBps,null);assert.equal(report.state,'live');
  }
  for(const [bid,ask] of [[101,99],[-1,101],[0,101],[99,Infinity],['99',101]]){
    const row=market();row.quote.bid=bid;row.quote.ask=ask;
    const report=marketHealth(row,{now});assert.equal(report.spread,null);assert.equal(report.spreadBps,null);assert.equal(report.state,'unavailable');
  }
  const locked=market();locked.quote.bid=100;locked.quote.ask=100;
  assert.equal(marketHealth(locked,{now}).spread,0);assert.equal(marketHealth(locked,{now}).spreadBps,0);
});

test('forming progress exists only during the actual current candle interval',()=>{
  const start=now-450000,row=market();
  assert.equal(marketHealth(row,{now:start}).formingBarProgressPct,0);
  assert.equal(marketHealth(row,{now:start+interval/4}).formingBarProgressPct,25);
  assert.equal(marketHealth(row,{now:start+interval-1}).formingBarProgressPct,100*(interval-1)/interval);
  for(const clock of [start-1,start+interval,start+interval+1])assert.equal(marketHealth(row,{now:clock}).formingBarProgressPct,null);
  for(const currentBar of [null,bar(start),bar(start,{closed:false,time:'invalid'}),bar(start,{closed:false,high:50})]){
    assert.equal(marketHealth(market({currentBar}),{now}).formingBarProgressPct,null);
  }
});

test('closed candle coverage excludes forming, future, invalid and duplicate records',()=>{
  const row=market(),lastStart=now-450000-interval;
  row.bars.push(bar(lastStart),bar(now-1000),bar(now+interval),bar(lastStart-interval*3,{low:200}),bar(lastStart-interval*4,{closed:false}),bar(lastStart-interval*5,{time:'invalid'}));
  const report=marketHealth(row,{now});assert.equal(report.barCount,3);assert.equal(report.consecutiveClosedBars,3);
  assert.equal(report.lastClosedAt,iso(now-450000));assert.equal(report.closedAgeMs,450000);
  const futureOnly=market({bars:[bar(now+interval)]});
  assert.equal(marketHealth(futureOnly,{now}).lastClosedAt,null);assert.equal(marketHealth(futureOnly,{now}).closedAgeMs,null);
});

test('a regular Nasdaq session break is informational and does not invalidate a provider snapshot',()=>{
  const row=market({symbol:'NDX',live:false,feed:{status:'snapshot',transport:'import'},
    quote:{price:25000,receivedAt:iso(now-1000),capturedAt:iso(now-500),transport:'import'},
    bars:[bar(now-450000-interval*100),bar(now-450000-interval*2),bar(now-450000-interval)],
    provenance:{marketOpen:true,sessionValidated:true}});
  const report=marketHealth(row,{now});assert.equal(report.barCount,3);assert.equal(report.consecutiveClosedBars,2);assert.equal(report.state,'snapshot');
  row.provenance.marketOpen=false;assert.equal(marketHealth(row,{now}).state,'closed');
});

test('model health preserves pending and errors while future, missing or unrelated ready clocks fail closed',()=>{
  for(const status of ['pending','error','unavailable']){
    const report=marketHealth(market({model:{status,trainedAt:null}}),{now});assert.equal(report.modelStatus,status);assert.equal(report.modelAgeMs,null);
  }
  for(const model of [null,{}, {status:'ready',trainedAt:null},{status:'ready',trainedAt:iso(now+1)}, {status:'ready',trainedAt:iso(now-1000),source:'Another source'}]){
    const report=marketHealth(market({model}),{now});assert.equal(report.modelStatus,'unavailable');assert.equal(report.modelAgeMs,null);
  }
});

test('empty input and invalid current clocks expose unknown measurements without mutation',()=>{
  const empty=marketHealth(null,{now});assert.equal(empty.state,'unavailable');assert.equal(empty.symbol,null);assert.equal(empty.barCount,0);assert.equal(empty.consecutiveClosedBars,0);
  for(const key of ['source','transport','quoteAt','quoteAgeMs','quoteEventAt','quoteEventAgeMs','spread','spreadBps','lastClosedAt','closedAgeMs','formingBarProgressPct','modelAgeMs'])assert.equal(empty[key],null,key);
  const row=market(),before=structuredClone(row);
  for(const clock of [NaN,Infinity,-1,null,'invalid']){
    const report=marketHealth(row,{now:clock});assert.equal(report.state,'unavailable');assert.equal(report.quoteAgeMs,null);assert.equal(report.closedAgeMs,null);assert.equal(report.formingBarProgressPct,null);assert.equal(report.modelAgeMs,null);
  }
  const first=marketHealth(row,{now}),second=marketHealth(row,{now:now+1000});
  assert.equal(second.quoteAgeMs-first.quoteAgeMs,1000);assert.deepEqual(row,before);
});
