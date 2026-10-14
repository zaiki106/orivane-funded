import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionDiagnostics} from '../public/core/decision-diagnostics.mjs';

const targetKind='tp_before_sl_probability';
const market=confidence=>({symbol:'BTC/USD',source:'Synthetic diagnostic fixture',live:true,bars:[],decision:{side:'HOLD',confidence,
  directionalContext:{kind:'market_class_probability',percent:99},confidenceGate:{kind:targetKind,candidateSide:'BUY',candidatePercent:99,passed:true}}});
const control=value=>decisionDiagnostics(value).checks.find(check=>check.id==='confidence');

test('directional context above 60 cannot replace the official TP-before-SL score at or below 60',()=>{
  for(const percent of [59.9,60,60.04]){
    const value=market({kind:targetKind,percent}),original=structuredClone(value),check=control(value);
    assert.equal(check.label,'Objectif avant stop > 60 %');assert.equal(check.status,'blocked');assert.ok(!check.detail.includes('99'));assert.deepEqual(value,original);
  }
  assert.equal(control(market({kind:targetKind,percent:60.1})).status,'passed');
});

test('a missing TP/SL estimate stays unavailable despite a directional estimate and legacy gate percentage',()=>{
  const check=control(market({kind:targetKind,percent:null,probability:null}));
  assert.equal(check.status,'unavailable');assert.equal(check.detail,'Probabilité objectif avant stop indisponible');
});

test('TP probabilities use the same displayed rounding when their percent field is absent',()=>{
  assert.equal(control(market({kind:targetKind,probability:.60049})).status,'blocked');
  const check=control(market({kind:targetKind,probability:.601}));assert.equal(check.status,'passed');assert.equal(check.detail,'60.1 %');
});

test('legacy direction-only diagnostics retain their earlier gate contract',()=>{
  const value={symbol:'EUR/USD',bars:[],decision:{side:'HOLD',confidence:{kind:'market_class_probability'},confidenceGate:{candidateSide:'SELL',candidatePercent:80}}};
  const check=control(value);assert.equal(check.label,'Direction > 60 %');assert.equal(check.status,'passed');assert.equal(check.detail,'80 %');
});
