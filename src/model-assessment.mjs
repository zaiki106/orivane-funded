// A publication gate, not a model selector or a claim of trading profitability.
// The held-out report is consulted only to suppress unsupported estimates.
export function assessModel(model){
  const report=model?.test;
  const valid=model?.audited===true&&Number.isInteger(report?.sample)&&report.sample>=40&&
    [report.brier,report.baselineBrier].every(x=>Number.isFinite(x)&&x>=0&&x<=2);
  if(!valid)return {passed:false,status:'missing-evidence',reason:'Évaluation du modèle insuffisante'};
  const passed=report.baselineBrier>0&&report.brier<report.baselineBrier;
  return {passed,status:passed?'better-than-reference':'no-edge',
    reason:passed?'Erreur inférieure à la référence sur le test historique':'Modèle non retenu : aucune amélioration sur la référence',
    sample:report.sample,brier:report.brier,baselineBrier:report.baselineBrier};
}

export function applyModelAssessment(decision,model){
  const modelAssessment=assessModel(model);
  if(modelAssessment.passed)return {...decision,modelAssessment};
  // Keep an existing actionable block visible; model evidence remains separately
  // available in modelAssessment and the confidence explanation.
  const reason=decision.side==='HOLD'&&decision.reason?decision.reason:modelAssessment.reason;
  return {...decision,side:'HOLD',reason,entry:null,stop:null,target:null,
    setup:decision.setup?{...decision.setup,confirmed:false,entry:null,stop:null,target:null}:undefined,
    confidence:{...decision.confidence,percent:null,classProbs:null,status:'unvalidated',
      reason:modelAssessment.reason,neighboursDetail:[]},
    confidenceGate:{...decision.confidenceGate,candidatePercent:null,passed:false},
    filteredByModelEvidence:true,modelAssessment};
}
