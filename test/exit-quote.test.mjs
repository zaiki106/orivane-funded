import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPlan} from '../src/execution-plan.mjs';
test('a BUY cannot enter when Bid has already crossed its stop despite a safe displayed price',()=>{
  const p=executionPlan({side:'BUY',entry:100,stop:99.8,target:101,atr:2},{price:100,bid:99.7,ask:100.1});
  assert.equal(p.valid,false);assert.equal(p.filteredByLevels,true);assert.match(p.reason,/Stop/);
});
test('a SELL cannot enter when Ask has already crossed its stop despite a safe displayed price',()=>{
  const p=executionPlan({side:'SELL',entry:100,stop:100.2,target:99,atr:2},{price:100,bid:99.9,ask:100.3});
  assert.equal(p.valid,false);assert.equal(p.filteredByLevels,true);assert.match(p.reason,/Stop/);
});
test('displayed last-price crossing alone does not falsely stop a position with an intact executable quote',()=>{
  const p=executionPlan({side:'BUY',entry:100,stop:99.8,target:101,atr:2},{price:99.7,bid:99.9,ask:100});
  assert.equal(p.valid,true);
});
