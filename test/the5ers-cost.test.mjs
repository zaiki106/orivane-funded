import test from 'node:test';
import assert from 'node:assert/strict';
import {costForSymbol,roundTripFee,directionalCostFraction,validTradingCost} from '../src/cost-policy.mjs';
import {executionPlan} from '../src/execution-plan.mjs';
import {backtest,signal} from '../src/engine.mjs';
import {labelOutcome} from '../src/decision.mjs';

test('published forex commission is four dollars per 100000-unit round trip at any price',()=>{
  for(const symbol of ['EUR/USD','GBP/USD']){
    const cost=costForSymbol(symbol,{profile:'the5ers'});assert.equal(cost.commissionVerified,true);assert.equal(cost.feeBps,0);
    for(const [entry,exit] of [[1.1,1.2],[1.3,1.25]])assert.equal(roundTripFee(cost,entry,exit)*100000,4);
    assert.equal(directionalCostFraction(cost,1.25),.0004+.00004/1.25);
    assert.equal(cost.spreadIncluded,false);assert.equal(cost.slippageVerified,false);
  }
  assert.equal(costForSymbol('NDX',{profile:'the5ers'}).feeBps,0);
  for(const s of ['BTC/USD','XAU/USD'])assert.equal(costForSymbol(s,{profile:'the5ers'}).commissionVerified,false);
  assert.deepEqual(costForSymbol('BTC/USD',{profile:'generic'}),{feeBps:10,slippageBps:5,assumption:true});
  assert.throws(()=>costForSymbol('EUR/USD',{profile:'unknown'}));
  for(const feePerUnit of [-1,NaN,Infinity])assert.equal(validTradingCost({feeBps:0,slippageBps:2,feePerUnit}),false);
});

test('execution risk and net target use fixed forex fees without an invented percent commission',()=>{
  const cost={...costForSymbol('EUR/USD',{profile:'the5ers'}),slippageBps:0};
  const p=executionPlan({side:'BUY',entry:1.1,stop:1.099,target:1.102,atr:.001},null,cost);
  assert.ok(p.valid);assert.ok(Math.abs(p.netRisk-(.001+.00004))<1e-12);assert.ok(Math.abs(p.netReward-(.002-.00004))<1e-12);
  assert.equal(executionPlan({side:'BUY',entry:1.1,stop:1.099,target:1.10002,atr:.001},null,cost).filteredByCosts,true);
});

test('direction labels convert fixed forex dollars to a price-dependent fraction',()=>{
  const bars=Array.from({length:85},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:1.1,high:1.101,low:1.099,close:i>=81?1.1001:1.1,volume:0}));
  const cost={...costForSymbol('EUR/USD',{profile:'the5ers'}),slippageBps:0},outcome=labelOutcome(bars,80,{neutralAtr:0,cost});
  assert.equal(outcome.label,'UP');assert.ok(Math.abs(outcome.roundTripCost-.00004/1.1)<1e-12);
  const generic=labelOutcome(bars,80,{neutralAtr:0,cost:{feeBps:2,slippageBps:2}});assert.equal(generic.label,'FLAT');
});

test('backtest entry and exit both account for the fixed fee, including same-candle exit',()=>{
  const bars=Array.from({length:81},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:1.1,high:1.10001,low:1.09999,close:1.1,volume:100}));
  bars[79]={...bars[79],high:1.1011,close:1.101,volume:200};
  const raw=signal(bars.slice(0,80),'breakout');assert.equal(raw.side,'BUY');
  bars[80]={...bars[80],open:raw.entry,high:raw.target+.0001,low:raw.stop-.0001,close:raw.entry};
  bars.push({...bars[80],time:new Date(Date.parse(bars[80].time)+900000).toISOString()});
  const c={...costForSymbol('EUR/USD',{profile:'the5ers'}),slippageBps:0},a=backtest(bars,'breakout',c);
  assert.equal(a.n,1);assert.equal(a.trades[0].reason,'Stop');assert.ok(Math.abs(a.trades[0].r+1)<1e-12);
  const r=backtest([...bars,{...bars[80],time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString()}],'breakout',c);assert.equal(r.n,1);
});
