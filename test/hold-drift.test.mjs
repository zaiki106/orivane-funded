import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPlan} from '../src/execution-plan.mjs';
test('unchanged executable FX quote is not market drift when slippage exceeds half ATR',()=>{
 const s={side:'BUY',entry:1.1,stop:1.098,target:1.104,atr:.0003};
 const p=executionPlan(s,{price:1.1,ask:1.10002,bid:1.09998},{feeBps:0,feePerUnit:.00002,slippageBps:2});
 assert.equal(p.valid,true);assert.equal(p.filteredByPrice,false);
 assert.ok(p.entry>1.10002);assert.ok(p.netReward<1.104-1.1);
 assert.ok(p.netRisk>1.1-1.098);
});
test('actual quote movement beyond half ATR remains blocked for BUY and SELL',()=>{
 for(const side of ['BUY','SELL']){
  const dir=side==='BUY'?1:-1,s={side,entry:1.1,stop:1.1-dir*.002,target:1.1+dir*.004,atr:.0003};
  const p=executionPlan(s,{price:1.1002},{feeBps:0,slippageBps:2});
  assert.equal(p.filteredByPrice,true);assert.equal(p.valid,false);
 }
});
