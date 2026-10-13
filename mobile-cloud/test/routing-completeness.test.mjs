import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {routeStrategy,decide} from '../public/core/decision.mjs';
import {signal} from '../public/core/engine.mjs';

const {cases}=JSON.parse(fs.readFileSync(new URL('./fixtures/missed-routing-real.json',import.meta.url)));
for(const sample of cases)test(`Router retains completed ${sample.expected} on ${sample.symbol} ${sample.time}`,()=>{
  const route=routeStrategy(sample.bars);
  assert.equal(route.strategy,sample.expected);
  assert.notEqual(signal(sample.bars,route.strategy).side,'HOLD');
  // A technical trigger alone must never bypass the user's probability requirement.
  const decision=decide(sample.bars,null,{fresh:true,symbol:sample.symbol});
  assert.equal(decision.side,'HOLD');
  assert.ok(['BUY','SELL'].includes(decision.confidenceGate.candidateSide));
  assert.equal(decision.confidenceGate.passed,false);
});

