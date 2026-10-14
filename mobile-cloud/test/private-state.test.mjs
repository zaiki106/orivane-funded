import test from 'node:test';import assert from 'node:assert/strict';import {validatePrivateImport} from '../public/core/private-state.mjs';import {defaultProfile} from '../public/core/profile.mjs';
import {makeTradePlan,validTradePlan,observeTradeOutcome} from '../public/core/trade-outcome.mjs';
const data=()=>({schemaVersion:2,profile:{...defaultProfile},positions:[],history:[],followups:[],daily:{}});
test('private import supports old empty journals and rejects invalid schemas, risk profiles and arbitrary position objects',()=>{
  assert.deepEqual(validatePrivateImport(data()).positions,[]);const old=data();delete old.schemaVersion;assert.equal(validatePrivateImport(old).profile.capital,100000);
  assert.throws(()=>validatePrivateImport({...data(),schemaVersion:99}));assert.throws(()=>validatePrivateImport({...data(),positions:[{status:'open',quantity:-1}]}));assert.throws(()=>validatePrivateImport({...data(),profile:{...defaultProfile,riskPercent:99}}));
});
test('restored trade plan keeps immutable cost arithmetic and rejects invented PNL or risk',()=>{
  const cost={feeBps:0,slippageBps:0},plan=makeTradePlan({side:'BUY',strategy:'breakout',entry:100,stop:90,target:120,atr:10},{price:100},cost,{entryTime:'2026-01-01T00:00:00Z'});
  const p={id:'restore',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'open',mode:'paper-device',openedAt:'2026-01-01T00:00:00Z',entry:100,stop:90,target:120,quantity:1,netRisk:10,cost,plan};
  const restored=validatePrivateImport({...data(),positions:[p]}).positions[0];assert.equal(validTradePlan(restored.plan),true);
  assert.throws(()=>validatePrivateImport({...data(),positions:[{...p,plan:undefined,netRisk:.00001}]}));
  assert.throws(()=>validatePrivateImport({...data(),positions:[{...p,status:'closed',exit:110,pnl:1000000000,closedAt:'2026-01-02T00:00:00Z'}]}));
});
test('journal import whitelists fields and never restores live broker orders',()=>{
  const p={id:'test',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'open',mode:'paper-device',openedAt:'2026-01-01T00:00:00Z',entry:100,stop:90,target:120,quantity:1,netRisk:10,cost:{feeBps:0,slippageBps:0},unknown:'secret'};
  const d={...data(),positions:[p]};assert.equal(validatePrivateImport(d).positions[0].unknown,undefined);assert.throws(()=>validatePrivateImport({...d,positions:[{...p,mode:'live'}]}));assert.throws(()=>validatePrivateImport({...d,positions:[p,p]}));
});
test('restored followups retain exact TP/SL plans and still expire before late target observations',()=>{
 const at=Date.UTC(2026,0,1),plan=makeTradePlan({side:'BUY',strategy:'breakout',entry:100,stop:90,target:120,atr:10},{price:100},{feeBps:0,slippageBps:0},{entryTime:at});
 const event={id:'follow',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',entry:100,stop:90,target:120,confidencePercent:73,confidenceKind:'tp_before_sl_probability',status:'watching',observedAt:new Date(at+500).toISOString(),signalObservedAt:new Date(at+500).toISOString(),referenceTime:plan.entryTime,horizonEndAt:plan.expiryTime,plan};
 const restored=validatePrivateImport({...data(),followups:[event]}).followups[0];assert.equal(validTradePlan(restored.plan),true);assert.equal(restored.plan.expiryTimeMs,plan.expiryTimeMs);
 const late=observeTradeOutcome(restored.plan,{time:plan.expiryTimeMs+1,price:125,bid:125,ask:125.1});assert.equal(late.status,'expired');assert.equal(late.y,0);
 for(const changed of [{...event,target:130},{...event,horizonEndAt:new Date(plan.expiryTimeMs+1).toISOString()},{...event,confidenceKind:'market_direction_probability'}])assert.throws(()=>validatePrivateImport({...data(),followups:[changed]}));
});
test('finite extreme quantities and overflowing products cannot corrupt account totals',()=>{
 const p={id:'extreme',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'open',mode:'paper-device',openedAt:'2026-01-01T00:00:00Z',entry:100,stop:90,target:120,quantity:1,netRisk:10,cost:{feeBps:0,slippageBps:0}};
 for(const quantity of [1e308,1e100,10000])assert.throws(()=>validatePrivateImport({...data(),positions:[{...p,quantity}]}));
 const overflow={...p,status:'closed',quantity:100,exit:1e308,pnl:1e308,closedAt:'2026-01-02T00:00:00Z'};assert.throws(()=>validatePrivateImport({...data(),positions:[overflow]}));
});
test('observation gap and precise last quote timestamp survive private journal restoration',()=>{
 const at=Date.UTC(2026,0,1),p={id:'metadata',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'open',mode:'paper-device',openedAt:new Date(at).toISOString(),entry:100,stop:90,target:120,quantity:1,netRisk:10,cost:{feeBps:0,slippageBps:0},observationGap:true,lastObservationTime:at+1000,confidenceKind:'tp_before_sl_probability',confidencePercent:65};
 const restored=validatePrivateImport({...data(),positions:[p]}).positions[0];assert.equal(restored.observationGap,true);assert.equal(restored.lastObservationTime,at+1000);assert.equal(restored.confidencePercent,65);
 assert.throws(()=>validatePrivateImport({...data(),positions:[{...p,lastObservationTime:at-1}]}));
});
test('legitimate negative simulated equity after a stop gap remains importable',()=>{
 const entry=100,stop=100.01,quantity=1000,cost={feeBps:0,slippageBps:0},p={id:'gap-loss',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'SELL',status:'closed',mode:'paper-device',openedAt:'2026-01-01T00:00:00Z',closedAt:'2026-01-02T00:00:00Z',entry,stop,target:99.98,quantity,netRisk:stop-entry,cost,exit:201,pnl:-101000};
 const restored=validatePrivateImport({...data(),positions:[p],daily:{'2026-01-02':-1000}});assert.equal(restored.positions[0].pnl,-101000);assert.equal(restored.daily['2026-01-02'],-1000);
});

test('physical execution time survives restoration without moving the closed-bar deadline',()=>{
 const at=Date.UTC(2026,0,1),executed=at+45000,cost={feeBps:0,slippageBps:0},plan=makeTradePlan({side:'BUY',strategy:'breakout',entry:100,stop:90,target:120,atr:10},{price:100},cost,{entryTime:at,executionTime:executed});
 const position={id:'boundary',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'open',mode:'paper-device',openedAt:new Date(executed).toISOString(),entry:100,stop:90,target:120,quantity:1,netRisk:10,cost,plan};
 const restored=validatePrivateImport({...data(),positions:[position]}).positions[0];assert.equal(validTradePlan(restored.plan),true);assert.equal(restored.plan.executionTimeMs,executed);assert.equal(restored.plan.expiryTimeMs,at+16*900000);
 const event={...position,id:'follow-boundary',status:'watching',confidencePercent:73,observedAt:position.openedAt,signalObservedAt:position.openedAt,referenceTime:plan.entryTime,horizonEndAt:plan.expiryTime};
 assert.equal(validatePrivateImport({...data(),followups:[event]}).followups[0].plan.executionTimeMs,executed);
 assert.throws(()=>validatePrivateImport({...data(),positions:[{...position,openedAt:new Date(executed-1).toISOString()}]}));
 const legacy={...plan};for(const key of ['entryPolicy','maxEntryDelayMs','executionTime','executionTimeMs'])delete legacy[key];
 assert.equal(validatePrivateImport({...data(),positions:[{...position,openedAt:new Date(at).toISOString(),plan:legacy}]}).positions[0].plan.executionTimeMs,undefined);
});

test('censored observed exits restore economic PNL without restoring an invented first-TP outcome',()=>{
 const openedAt='2026-01-01T00:00:00Z',closedAt='2026-01-01T00:01:00Z',p={id:'coverage',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',status:'closed',mode:'paper-device',openedAt,closedAt,entry:100,stop:90,target:120,quantity:1,netRisk:10,cost:{feeBps:0,slippageBps:0},exit:120,pnl:20,outcome:'censored',observedBarrier:'target',observationGap:true,observationSession:'session',streamGeneration:'1:book:2',lastObservationTime:Date.parse(closedAt)};
 const restored=validatePrivateImport({...data(),positions:[p]}).positions[0];assert.equal(restored.outcome,'censored');assert.equal(restored.observedBarrier,'target');assert.equal(restored.pnl,20);assert.equal(restored.observationSession,'session');
 const event={...p,id:'follow-coverage',status:'censored',observedAt:closedAt,signalObservedAt:openedAt,confidencePercent:73};const follow=validatePrivateImport({...data(),followups:[event]}).followups[0];assert.equal(follow.status,'censored');assert.equal(follow.observationGap,true);assert.equal(follow.observedBarrier,'target');
 for(const changed of [{...p,observationGap:false},{...p,observedBarrier:undefined},{...p,observedBarrier:'unknown'}])assert.throws(()=>validatePrivateImport({...data(),positions:[changed]}));
});
