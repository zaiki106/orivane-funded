import test from 'node:test';import assert from 'node:assert/strict';import {paperQuoteUpdates} from '../src/paper-observer.mjs';import {makeTradePlan} from '../src/trade-outcome.mjs';
const at=Date.UTC(2026,9,14),cost={feeBps:0,slippageBps:0};
const position=side=>{const raw={side,strategy:'breakout',entry:100,stop:side==='BUY'?90:110,target:side==='BUY'?120:80,atr:10},plan=makeTradePlan(raw,{price:100},cost,{entryTime:at});return {id:'p',symbol:'BTC/USD',source:'Kraken public · spot',side,status:'open',openedAt:new Date(at).toISOString(),quantity:1,cost,entry:100,stop:raw.stop,target:raw.target,netRisk:10,plan};};
function quote(price,ms){return {price,bid:price,ask:price,transport:'websocket',eventTime:new Date(ms).toISOString(),receivedAt:new Date(ms).toISOString()};}
for(const side of ['BUY','SELL'])test(`${side}: first target or stop is settled before the next display refresh`,()=>{
  for(const first of ['target','stop']){const p=position(side),initial=paperQuoteUpdates([p],p.symbol,p.source,quote(p[first],at+100),{now:at+200});Object.assign(p,initial[0]);assert.equal(p.outcome,first);assert.equal(p.status,'closed');
    const next=paperQuoteUpdates([p],p.symbol,p.source,quote(first==='target'?p.stop:p.target,at+200),{now:at+300});assert.deepEqual(next,[]);assert.equal(p.outcome,first);}
});
test('wrong source, pre-entry, stale and crossed quotes cannot settle paper',()=>{
  const p=position('BUY');assert.deepEqual(paperQuoteUpdates([p],p.symbol,'Other provider',quote(90,at+100),{now:at+200}),[]);
  assert.deepEqual(paperQuoteUpdates([p],p.symbol,p.source,quote(90,at-100),{now:at+200}),[]);
  assert.deepEqual(paperQuoteUpdates([p],p.symbol,p.source,quote(90,at+100),{now:at+40000}),[]);
  const out=paperQuoteUpdates([p],p.symbol,p.source,{...quote(90,at+100),bid:100,ask:99},{now:at+200});assert.ok(out.every(x=>x.status!=='closed'));
});

test('nonfinite quantity-adjusted settlement cannot corrupt the paper journal',()=>{
 const p=position('BUY');delete p.plan;p.quantity=1e200;
 const out=paperQuoteUpdates([p],p.symbol,p.source,quote(1e200,at+100),{now:at+200});
 assert.equal(out[0].observationGap,true);assert.equal(out[0].status,undefined);assert.equal(out[0].pnl,undefined);
});

test('a gap before the first quote censors TP ordering while keeping actual simulated PNL',()=>{
 const p=position('BUY'),first=paperQuoteUpdates([p],p.symbol,p.source,quote(120,at+30001),{now:at+30002})[0];
 assert.equal(first.status,'closed');assert.equal(first.observationGap,true);assert.equal(first.outcome,'censored');assert.equal(first.observedBarrier,'target');assert.equal(first.exit,120);assert.equal(first.pnl,20);assert.match(first.reason,/indéterminé/);
 const recent=paperQuoteUpdates([position('BUY')],p.symbol,p.source,quote(120,at+30000),{now:at+30001})[0];assert.equal(recent.outcome,'target');
});

test('prior interruption, reconnect generation or device session cannot produce a validated TP label',()=>{
 const p=position('BUY');
 for(const [record,flags] of [[{...p,observationGap:true},{}],[p,{gap:true}],[p,{sequenceGap:true}],[p,{streamInterrupted:true}],[{...p,streamGeneration:'1:book:1'},{streamGeneration:'1:book:2'}],[{...p,observationSession:'old'},{observationSession:'new'}],[p,{streamConnectedAt:new Date(at+50).toISOString()}]]){
  const out=paperQuoteUpdates([record],p.symbol,p.source,{...quote(120,at+100),...flags},{now:at+200})[0];assert.equal(out.outcome,'censored');assert.equal(out.observedBarrier,'target');assert.equal(out.pnl,20);
 }
});

test('continuous observations preserve target ordering and a later gap remains censored through expiry',()=>{
 const p=position('BUY'),initial=paperQuoteUpdates([p],p.symbol,p.source,quote(100,at+100),{now:at+200})[0];Object.assign(p,initial);
 assert.equal(initial.observationGap,false);const target=paperQuoteUpdates([p],p.symbol,p.source,quote(120,at+200),{now:at+300})[0];assert.equal(target.outcome,'target');
 const gap=paperQuoteUpdates([p],p.symbol,p.source,quote(101,at+40000),{now:at+40001})[0];Object.assign(p,gap);assert.equal(gap.observationGap,true);
 const expired=paperQuoteUpdates([p],p.symbol,p.source,quote(125,p.plan.expiryTimeMs),{now:p.plan.expiryTimeMs+1})[0];assert.equal(expired.outcome,'censored');assert.equal(expired.observedBarrier,'expired');assert.equal(expired.pnl,25);
});

test('a crossed liquidation book also blocks legacy paper and invalidates observation coverage',()=>{
 const p=position('BUY');delete p.plan;
 const crossed=paperQuoteUpdates([p],p.symbol,p.source,{...quote(120,at+100),bid:121,ask:120},{now:at+200})[0];
 assert.equal(crossed.status,undefined);assert.equal(crossed.observationGap,true);Object.assign(p,crossed);
 const valid=paperQuoteUpdates([p],p.symbol,p.source,quote(120,at+200),{now:at+300})[0];assert.equal(valid.outcome,'censored');assert.equal(valid.observedBarrier,'target');
});
