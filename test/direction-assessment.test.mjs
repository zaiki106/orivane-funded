import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDirection,applyModelAssessment} from '../src/model-assessment.mjs';
import {fitClassCalibration,adjustClassProbabilities} from '../src/class-calibration.mjs';
const model={audited:true,test:{sample:100,brier:.7,baselineBrier:.6,directional:{UP:{sample:100,positive:30,brier:.15,baselineBrier:.21},DOWN:{sample:100,positive:30,brier:.3,baselineBrier:.21}}}};
const decision=side=>({side,entry:100,stop:98,target:104,confidence:{percent:70},confidenceGate:{candidateClass:side==='BUY'?'UP':'DOWN',candidatePercent:70,passed:true}});

test('an independently better BUY direction is not vetoed by a worse unrelated class',()=>{
  const result=applyModelAssessment(decision('BUY'),model);
  assert.equal(result.side,'BUY');assert.equal(result.confidence.percent,70);
  assert.equal(result.modelAssessment.status,'direction-better-than-reference');
  assert.equal(result.modelAssessment.globalAssessment.passed,false);
});
test('a passing direction cannot rescue a failing opposite direction or bypass other guards',()=>{
  const result=applyModelAssessment(decision('SELL'),model);
  assert.equal(result.side,'HOLD');assert.equal(result.confidence.percent,null);
  const held={...decision('BUY'),side:'HOLD',reason:'Filtre H1 opposé',entry:null,stop:null,target:null};
  assert.equal(applyModelAssessment(held,model).side,'HOLD');
  assert.equal(applyModelAssessment(held,model).reason,held.reason);
  const globalPassing={...model,test:{...model.test,brier:.4}};
  assert.equal(applyModelAssessment(decision('SELL'),globalPassing).side,'HOLD');
});
test('equal, missing, degenerate and malformed directional evidence never authorizes a signal',()=>{
  for(const event of [undefined,{sample:100,positive:4,brier:.1,baselineBrier:.2},{sample:100,positive:96,brier:.1,baselineBrier:.2},{sample:100,positive:30,brier:.2,baselineBrier:.2},{sample:99,positive:30,brier:.1,baselineBrier:.2},{sample:100,positive:30,brier:NaN,baselineBrier:.2}]){
    const bad={...model,test:{...model.test,directional:{UP:event}}};
    assert.equal(assessDirection(bad,'UP').passed,false);
    assert.equal(applyModelAssessment(decision('BUY'),bad).side,'HOLD');
  }
});
test('class calibration corrects a known frequency shift and normalizes without a probability floor',()=>{
  const rows=Array.from({length:100},(_,i)=>({probabilities:[.8,.1,.1],actual:i<20?0:i<50?1:2}));
  const fitted=fitClassCalibration(rows),p=adjustClassProbabilities([.8,.1,.1],fitted);
  assert.ok(p[0]<.3&&p[2]>.4);assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.equal(fitted.partition,'calibration');assert.equal(fitted.holdoutUsed,false);
  assert.equal(fitClassCalibration(rows.slice(0,49)),null);
  assert.equal(adjustClassProbabilities([.8,.1,.1],{...fitted,bias:[NaN,0,0]}),null);
});
