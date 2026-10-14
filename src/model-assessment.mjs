// A publication gate, not a model selector or a claim of trading profitability.
import {modelForDirection} from './decision.mjs';
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
  const globalAssessment=assessModel(model),candidateClass=decision.confidenceGate?.candidateClass;
  const directional=assessDirection(model,candidateClass);
  const useDirection=['UP','DOWN'].includes(candidateClass)&&model?.test?.directional!=null;
  const modelAssessment=useDirection?{...directional,globalAssessment}:globalAssessment;
  if(modelAssessment.passed)return {...decision,modelAssessment};
  // Preserve independent execution/H1 blocks. A rejected probability must not
  // survive as the main reason once its model evidence is unavailable.
  const reason=decision.side==='HOLD'&&decision.reason&&!decision.filteredByConfidence?decision.reason:modelAssessment.reason;
  return {...decision,side:'HOLD',reason,entry:null,stop:null,target:null,
    setup:decision.setup?{...decision.setup,confirmed:false,entry:null,stop:null,target:null}:undefined,
    confidence:{...decision.confidence,percent:null,classProbs:null,status:'unvalidated',
      reason:modelAssessment.reason,neighboursDetail:[]},
    confidenceGate:{...decision.confidenceGate,candidatePercent:null,passed:false},
    filteredByModelEvidence:true,modelAssessment};
}

// Score the actual BUY/SELL event as one-vs-rest. A bad FLAT estimate alone
// must not veto a independently tested UP/DOWN estimate. No model is reselected.
export function assessDirection(model,className){
  model=modelForDirection(model,className);
  const report=model?.test,event=report?.directional?.[className];
  const valid=['UP','DOWN'].includes(className)&&model?.audited===true&&
    Number.isInteger(report?.sample)&&report.sample>=40&&event?.sample===report.sample&&
    Number.isInteger(event?.positive)&&event.positive>=5&&report.sample-event.positive>=5&&
    [event.brier,event.baselineBrier].every(x=>Number.isFinite(x)&&x>=0&&x<=1);
  if(!valid)return {passed:false,status:'missing-direction-evidence',reason:'Test directionnel insuffisant',class:className??null};
  const passed=event.baselineBrier>0&&event.brier<event.baselineBrier;
  return {passed,status:passed?'direction-better-than-reference':'no-direction-edge',
    reason:passed?'Direction '+(className==='UP'?'haussière':'baissière')+' validée sur le test historique':'Direction non retenue sur le test historique',
    class:className,sample:event.sample,positive:event.positive,brier:event.brier,baselineBrier:event.baselineBrier};
}
