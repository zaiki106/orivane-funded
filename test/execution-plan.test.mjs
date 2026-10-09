import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPlan} from '../src/execution-plan.mjs';
import {sizePosition} from '../src/engine.mjs';
const buy={side:'BUY',entry:100,stop:98,target:104,atr:2};
test('current executable entry uses the correct book side and retains the exact original levels',()=>{
  const cost={feeBps:2,slippageBps:2};
  for(const [s,q,expected] of [[buy,{price:100,bid:99.9,ask:100.1},100.1*1.0002],[{...buy,side:'SELL',stop:102,target:96},{price:100,bid:99.9,ask:100.1},99.9*.9998]]){
    const p=executionPlan(s,q,cost);assert.equal(p.valid,true);assert.equal(p.entry,expected);
    assert.equal(p.stop,s.stop);assert.equal(p.target,s.target);assert.equal(p.referenceEntry,100);
    const dir=s.side==='BUY'?1:-1,out=s.target*(1-dir*.0002);
    assert.ok(Math.abs(p.netReward-(dir*(out-expected)-(out+expected)*.0002))<1e-10);
  }
});
test('crossed books, reached levels, drift and costs cannot authorize a trade',()=>{
  for(const q of [{price:100,bid:101,ask:99},{price:98},{price:104},{price:101.01},{price:NaN}])assert.equal(executionPlan(buy,q).valid,false);
  const tiny={...buy,stop:99.99,target:100.01};assert.equal(executionPlan(tiny,{price:100},{feeBps:10,slippageBps:5}).filteredByCosts,true);
  assert.equal(executionPlan(buy,{price:100},{feeBps:NaN,slippageBps:0}).valid,false);
});

test('position sizing reserves the actual estimated loss at the unchanged stop after costs',()=>{
  const plan=executionPlan(buy,{price:100,bid:99.9,ask:100.1},{feeBps:2,slippageBps:2});
  const sized=sizePosition({capital:100000,riskPercent:.25,entry:plan.entry,stop:plan.stop,unitRisk:plan.netRisk});
  assert.ok(Math.abs(sized.risk-250)<1e-10);assert.ok(Math.abs(sized.quantity*plan.netRisk-250)<1e-10);
  const capped=sizePosition({capital:100,riskPercent:1,entry:100,stop:99.99,unitRisk:.01});
  assert.equal(capped.quantity,1);assert.equal(capped.risk,.01);assert.equal(capped.notional,100);
  assert.throws(()=>sizePosition({capital:100,riskPercent:1,entry:100,stop:99,unitRisk:NaN}));
});
