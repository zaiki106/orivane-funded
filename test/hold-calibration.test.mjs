import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateDecision} from '../src/decision.mjs';
test('quiet validation period evaluates the trained model rather than disabling it',()=>{
 const bars=Array.from({length:800},(_,i)=>{const close=i<400?100+6*Math.sin(i/12):100;
  return {time:new Date(Date.UTC(2025,0,1)+i*900000).toISOString(),open:close,high:close+.3,low:close-.3,close,volume:100};});
 const m=calibrateDecision({symbol:'TEST',source:'test-fixture',timeframe:15,bars},{iterations:30});
 assert.equal(m.calibrationRange.classSamples.UP,0);assert.equal(m.calibrationRange.classSamples.DOWN,0);
 assert.ok(Object.values(m.trainingRange.classSamples).every(n=>n>=5));
 assert.equal(m.status,'estimate');assert.equal(m.audited,true);
 assert.ok(Number.isFinite(m.test.brier));assert.ok(Number.isFinite(m.calibration.brier));
 assert.equal(m.selection.holdoutUsed,false);
});
