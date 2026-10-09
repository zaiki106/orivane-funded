import test from 'node:test';
import assert from 'node:assert/strict';
import {applyModelAssessment,assessModel} from '../src/model-assessment.mjs';
const decision={side:'BUY',entry:100,stop:98,target:104,setup:{confirmed:true,entry:100,stop:98,target:104},confidence:{percent:80,classProbs:{UP:.8,DOWN:.1,FLAT:.1},status:'estimate'},confidenceGate:{candidatePercent:80,passed:true}};
const model={audited:true,test:{sample:100,brier:.4,baselineBrier:.5}};

test('failed evidence does not mask an existing execution block or publish confidence',()=>{
  const rejected={...model,test:{...model.test,brier:.6}};
  for(const reason of ['Objectif déjà atteint par le cours actuel','Cours indisponibles ou périmés','Filtre H1 opposé au signal BUY']){
    const result=applyModelAssessment({...decision,side:'HOLD',reason},rejected);
    assert.equal(result.reason,reason);
    assert.equal(result.side,'HOLD');assert.equal(result.entry,null);
    assert.equal(result.modelAssessment.status,'no-edge');
    assert.equal(result.confidence.percent,null);assert.equal(result.confidence.classProbs,null);
    assert.equal(result.confidence.reason,result.modelAssessment.reason);
  }
  assert.equal(applyModelAssessment(decision,rejected).reason,assessModel(rejected).reason);
});
test('a worse or equal model cannot publish an otherwise 80 percent BUY or SELL',()=>{
  for(const side of ['BUY','SELL'])for(const brier of [.5,.6]){
    const result=applyModelAssessment({...decision,side},{...model,test:{...model.test,brier}});
    assert.equal(result.side,'HOLD');assert.equal(result.modelAssessment.status,'no-edge');
    assert.deepEqual([result.entry,result.stop,result.target,result.confidence.percent,result.confidence.classProbs],[null,null,null,null,null]);
    assert.equal(result.setup.confirmed,false);assert.equal(result.confidenceGate.passed,false);
    assert.equal(result.confidenceGate.candidatePercent,null);assert.equal(result.confidence.status,'unvalidated');
  }
});
test('absent, too small, unaudited and malformed evidence fail closed',()=>{
  for(const m of [null,{}, {...model,audited:false},{...model,test:{...model.test,sample:39}},...[-1,NaN,Infinity,3].map(brier=>({...model,test:{...model.test,brier}})),{...model,test:{...model.test,baselineBrier:0}}])assert.equal(applyModelAssessment(decision,m).side,'HOLD');
});
test('passing evidence preserves actual probabilities and every other decision guard',()=>{
  const result=applyModelAssessment(decision,model);assert.equal(result.side,'BUY');
  assert.deepEqual(result.confidence,decision.confidence);assert.equal(result.entry,100);
  const held={...decision,side:'HOLD',reason:'Stale data',entry:null,stop:null,target:null};
  assert.deepEqual(applyModelAssessment(held,model),{...held,modelAssessment:assessModel(model)});
  assert.equal(decision.confidence.percent,80);assert.equal(decision.side,'BUY');
});
