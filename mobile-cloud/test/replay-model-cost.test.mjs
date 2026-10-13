import test from 'node:test';import assert from 'node:assert/strict';import {replayDecisions} from '../public/core/decision-replay.mjs';
test('replay retains the exact model cost contract and stress multiplies both fixed and proportional costs',()=>{
 const cost={feeBps:.1,slippageBps:.2,feePerUnit:.00002,profile:'test-cost-contract',assumption:true},dataset={symbol:'EUR/USD',source:'Fixture',bars:[]};
 assert.deepEqual(replayDecisions(dataset,{cost}).cost,cost);
 const stress=replayDecisions(dataset,{cost},{costMultiplier:3}).cost;
 assert.ok(Math.abs(stress.feeBps-.3)<1e-12);assert.ok(Math.abs(stress.slippageBps-.6)<1e-12);assert.ok(Math.abs(stress.feePerUnit-.00006)<1e-12);
 assert.equal(stress.profile,cost.profile);assert.throws(()=>replayDecisions(dataset,{cost:{...cost,slippageBps:NaN}}));
});
