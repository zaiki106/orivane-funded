import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTradePlan,observeTradeOutcome,labelTradeOutcome,tradeSettlement,validTradePlan} from '../public/core/trade-outcome.mjs';
const t=Date.UTC(2026,0,1),cost={feeBps:0,slippageBps:0},raw={side:'BUY',strategy:'pullback',entry:100,stop:98,target:104,atr:2};
const plan=(side='BUY',options={})=>makeTradePlan(side==='BUY'?raw:{...raw,side,stop:102,target:96},{price:100},cost,{entryTime:t,maxBars:16,...options});
const bar=(i,values={})=>({time:new Date(t+i*900000).toISOString(),open:100,high:101,low:99,close:100,closed:true,...values});
test('exact quote labels use Bid for BUY exits and Ask for SELL exits',()=>{
 assert.equal(observeTradeOutcome(plan(),{time:t+1000,price:104,bid:103.9,ask:104.1}).status,'open');
 assert.equal(observeTradeOutcome(plan(),{time:t+2000,price:104.2,bid:104.1,ask:104.3}).status,'target');
 assert.equal(observeTradeOutcome(plan('SELL'),{time:t+1000,price:96,bid:95.9,ask:96.1}).status,'open');
 assert.equal(observeTradeOutcome(plan('SELL'),{time:t+2000,price:95.8,bid:95.7,ask:95.9}).status,'target');
 assert.equal(observeTradeOutcome(plan(),{time:t+1000,price:98.1,bid:98,ask:98.2}).status,'stop');
 assert.equal(observeTradeOutcome(plan('SELL'),{time:t+1000,price:101.9,bid:101.8,ask:102}).status,'stop');
});
test('OHLC chooses stop first when both barriers touch while timestamped ticks preserve event order',()=>{
 for(const side of ['BUY','SELL']){const p=plan(side),outcome=labelTradeOutcome(p,[bar(0,{high:105,low:95})]);assert.equal(outcome.y,0);assert.equal(outcome.status,'stop');assert.equal(outcome.ambiguous,true);assert.equal(outcome.convention,'stop-first-same-candle');}
 const sequence=[{time:t+1000,price:104,bid:104,ask:104.1},{time:t+2000,price:98,bid:98,ask:98.1}];
 assert.equal(labelTradeOutcome(plan(),sequence,{mode:'ticks'}).y,1);
});
test('expiry is target-event failure even if realized expiry PnL is positive',()=>{
 const bars=Array.from({length:16},(_,i)=>bar(i,{close:101})),result=labelTradeOutcome(plan(),bars);
 assert.equal(result.status,'expired');assert.equal(result.y,0);assert.equal(result.netR,.5);assert.equal(result.labelEndTimeMs,t+16*900000);
 assert.equal(observeTradeOutcome(plan(),{time:t+16*900000,price:105,bid:105,ask:105.1}).y,0);
});
test('missing, duplicate, crossed and incomplete observations are censored',()=>{
 assert.equal(labelTradeOutcome(plan(),[bar(0),bar(2)]).reason,'observation-gap');
 assert.equal(labelTradeOutcome(plan(),[bar(0),bar(0)]).reason,'observation-gap');
 assert.equal(labelTradeOutcome(plan(),[bar(0)]).reason,'incomplete-horizon');
 assert.equal(observeTradeOutcome(plan(),{time:t+1000,bid:101,ask:100,price:100.5}).reason,'invalid-book');
 assert.equal(observeTradeOutcome(plan(),{time:t+1000,bid:100,ask:101,price:100.5,gap:true}).reason,'observation-gap');
});
test('execution and settlement charge entry/exit slippage and round-trip commission exactly once',()=>{
 const c={feeBps:10,feePerUnit:.01,slippageBps:5},p=makeTradePlan(raw,{price:100,bid:99.9,ask:100.1},c,{entryTime:t});
 assert.equal(p.entry,100.1*1.0005);assert.equal(p.stop,98);assert.equal(p.target,104);
 const s=tradeSettlement(p,104),expectedExit=104*.9995,expectedFees=(p.entry+expectedExit)*.001+.02;
 assert.equal(s.exit,expectedExit);assert.equal(s.fees,expectedFees);assert.equal(s.netPnl,expectedExit-p.entry-expectedFees);
 assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.cost));assert.throws(()=>{p.stop=99;});
 assert.equal(p.netRisk,p.entry-98*.9995+(p.entry+98*.9995)*.001+.02);
});
test('observed adverse stop gap settles at the actual opening price',()=>{
 const r=labelTradeOutcome(plan(),[bar(0,{open:96,high:97,low:95,close:96})]);assert.equal(r.status,'stop');assert.equal(r.grossExit,96);assert.equal(r.netR,-2);
});
test('imported trade plans reject altered risk, target event and horizon arithmetic',()=>{
 const p=plan();assert.equal(validTradePlan(p),true);
 for(const value of [{...p,netRisk:.01},{...p,netReward:100},{...p,kind:'direction_probability'},{...p,expiryTimeMs:p.expiryTimeMs+1},{...p,referenceEntry:97}])assert.equal(validTradePlan(value),false);
});
test('provider event time takes precedence over local receipt time at the expiry boundary',()=>{
 const outcome=observeTradeOutcome(plan(),{eventTime:t+1000,receivedAt:t+16*900000,price:104,bid:104,ask:104.1});assert.equal(outcome.status,'target');assert.equal(outcome.labelEndTimeMs,t+1000);
});
test('ISO display times and executable numeric deadlines must agree exactly',()=>{
 const p=plan();
 for(const changed of [{...p,entryTimeMs:p.entryTimeMs+86400000,expiryTimeMs:p.expiryTimeMs+86400000},{...p,entryTime:'2025-01-01T00:00:00Z'},{...p,expiryTime:'2027-01-01T00:00:00Z'},{...p,entryTimeMs:p.entryTimeMs+.5,expiryTimeMs:p.expiryTimeMs+.5}])assert.equal(validTradePlan(changed),false);
 assert.throws(()=>plan('BUY',{entryTime:t+.5}));
});

test('an unparseable event timestamp censors the outcome before any later target',()=>{
 const unknown={price:97,bid:97,ask:97.1};
 for(const time of [undefined,'invalid',Infinity,t+.5,8640000000000001]){
  const result=labelTradeOutcome(plan(),[{...unknown,time},{time:t+1000,price:105,bid:105,ask:105.1}],{mode:'ticks'});
  assert.equal(result.status,'censored');assert.equal(result.y,null);assert.equal(result.reason,'invalid-observation-time');
 }
 assert.equal(labelTradeOutcome(plan(),[bar(0,{time:'invalid',low:97}),bar(1,{high:105})]).reason,'invalid-observation-time');
 assert.equal(observeTradeOutcome(plan(),{time:8640000000000001,bid:105,ask:105.1}).reason,'invalid-observation-time');
});

test('a delayed physical entry keeps the closed-bar expiry and requires ticks for labeling',()=>{
 const p=plan('BUY',{executionTime:t+45000});
 assert.equal(p.entryTimeMs,t);assert.equal(p.executionTimeMs,t+45000);assert.equal(p.expiryTimeMs,t+16*900000);assert.equal(validTradePlan(p),true);
 assert.equal(observeTradeOutcome(p,{time:t+1000,bid:105,ask:105.1}).reason,'invalid-observation-time');
 assert.equal(labelTradeOutcome(p,[bar(0,{high:105})]).reason,'intrabar-entry-needs-ticks');
 assert.equal(labelTradeOutcome(p,[{time:t+1000,bid:105,ask:105.1},{time:t+50000,bid:97,ask:97.1}],{mode:'ticks'}).status,'stop');
 assert.equal(observeTradeOutcome(p,{time:p.expiryTimeMs,bid:105,ask:105.1}).status,'expired');
 assert.equal(validTradePlan({...p,executionTime:new Date(t).toISOString()}),false);
 assert.throws(()=>plan('BUY',{executionTime:t+60001}));assert.throws(()=>plan('BUY',{entryTime:t+1,executionTime:t+1}));
 assert.throws(()=>plan('BUY',{intervalMs:1,maxBars:16,executionTime:t+16}));
 // Journals created before this policy remain importable.
 const legacy={...p};for(const key of ['entryPolicy','maxEntryDelayMs','executionTime','executionTimeMs'])delete legacy[key];
 assert.equal(validTradePlan(legacy),true);
});
