import {candleQuality} from './candle-quality.mjs';
import {tradeOutcomeKind} from './trade-outcome.mjs';
import {confidenceFromProbability} from './trade-inference.mjs';
// Explains the actual routed decision. Never selects a rule or changes its side.
export function decisionDiagnostics(market){
  const d=market.decision??{},candidate=d.confidenceGate?.candidateSide,plan=d.executionPlan;
  const check=(id,label,status,detail)=>({id,label,status,detail});
  const tradeConfidence=d.confidence?.kind===tradeOutcomeKind||!d.confidence?.kind&&d.confidenceGate?.kind===tradeOutcomeKind;
  // The official TP/SL score cannot fall back to the separate directional
  // context or a legacy candidatePercent. Compare its displayed tenth-percent.
  const score=tradeConfidence?d.confidence?.percent:d.confidenceGate?.candidatePercent;
  const probability=Number.isFinite(score)&&score>=0&&score<=100?Math.round(score*10)/10:
    tradeConfidence&&d.confidence?.kind===tradeOutcomeKind?confidenceFromProbability(d.confidence.probability):null;
  const confidenceLabel=tradeConfidence?'Objectif avant stop > 60 %':'Direction > 60 %';
  const unavailableProbability=tradeConfidence?'Probabilité objectif avant stop indisponible':'Estimation directionnelle indisponible';
  const hasCandidate=candidate==='BUY'||candidate==='SELL',h1=d.route?.higherTimeframe;
  const checks=[
    check('feed','Données actuelles',market.live===true&&!d.filteredByFreshness?'passed':'blocked',market.feed?.status??'unavailable'),
    check('setup','Déclencheur clôturé',hasCandidate?'passed':'blocked',hasCandidate?candidate:'Aucun BUY/SELL de la règle sélectionnée'),
    check('h1','Tendance H1',!h1?.available?'unavailable':d.filteredByH1?'blocked':'passed',!h1?.available?'Historique H1 insuffisant ; filtre non appliqué':h1.direction),
    check('model','Modèle vérifié',d.modelAssessment?.passed?'passed':d.filteredByModelEvidence?'blocked':'unavailable',d.modelAssessment?.reason??'Évaluation en préparation'),
    check('confidence',confidenceLabel,!hasCandidate||!Number.isFinite(probability)?'unavailable':probability>60?'passed':'blocked',Number.isFinite(probability)?probability+' %':unavailableProbability),
    check('levels','Entrée et niveaux',!hasCandidate||!plan?'unavailable':plan.filteredByLevels||plan.filteredByPrice?'blocked':'passed',!plan?'Plan indisponible':plan.filteredByLevels||plan.filteredByPrice?plan.reason:'Niveaux non invalidés'),
    check('costs','Objectif après frais',!hasCandidate||!plan?'unavailable':plan.filteredByCosts?'blocked':'passed',!plan?'Plan indisponible':plan.filteredByCosts?'Objectif net insuffisant':'Frais et glissement hypothétiques')
  ];
  return {symbol:market.symbol,source:market.source??null,signalTime:d.time??null,side:d.side??'HOLD',strategy:d.strategy??null,
    candidateSide:hasCandidate?candidate:null,ready:d.side==='BUY'||d.side==='SELL',reason:d.reason??'Analyse indisponible',
    checks,blockingCount:checks.filter(c=>c.status==='blocked').length,unavailableCount:checks.filter(c=>c.status==='unavailable').length,
    quoteAt:market.quote?.eventTime??market.quote?.receivedAt??null,
    candleQuality:candleQuality(market.bars,{timeframe:market.timeframe??15})};
}
