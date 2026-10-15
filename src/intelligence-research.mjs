import {createHash} from 'node:crypto';
import {makeTradePlan,labelTradeOutcome,tradeEntryPolicy} from './trade-outcome.mjs';
import {costForSymbol,validTradingCost} from './cost-policy.mjs';
import {metrics} from './engine.mjs';
import {intelligenceStrategies,intelligenceStrategiesVersion,analyzeIntelligenceContext,signalFromIntelligenceContext} from './intelligence-strategies.mjs';
import {fitRegimes,inferRegime,distributionDrift,calibratePredictionSets,predictionSet,adaptiveEnsemble} from './intelligence-ai.mjs';
import {fitResearchClassifier,predictResearchClassifier,fitRegimeOutcomeModel,predictRegimeOutcome,probabilityMetrics,researchLearnerVersion} from './intelligence-learning.mjs';
import {portfolioRisk,allocateResearchRisk} from './intelligence-risk.mjs';

export const intelligenceResearchVersion='orivane-intelligence-research-v1';
const interval=900000,embargo=16*interval;
const supported=['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX'];
const names=['return1Atr','return4Atr','atrFraction','ema20GapAtr','efficiency20','logVolumeRatio','volumeAvailable','bodyAtr','hourSin','hourCos'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const average=x=>x.reduce((s,v)=>s+v,0)/x.length;

export function validateResearchDataset(dataset,{asOf=Date.now()}={}){
 if(!Number.isSafeInteger(asOf)||!dataset||!supported.includes(dataset.symbol)||typeof dataset.source!=='string'||!dataset.source.trim()||dataset.timeframe!==15||!Array.isArray(dataset.bars)||dataset.bars.length>20000||Array.from(dataset.bars).some(b=>!b||typeof b!=='object'))throw Error('A documented supported instrument, source and at most 20000 actual 15m bars are required');
 const bars=dataset.bars.filter(b=>b?.closed!==false);
 if(bars.length<320)throw Error('At least 320 closed bars are required');
 let previous=-Infinity;
 for(const b of bars){const time=Date.parse(b.time);if(typeof b.time!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(b.time)||!Number.isSafeInteger(time)||time%interval||time<=previous||time+interval>asOf||![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||b.volume!=null&&(!Number.isFinite(b.volume)||b.volume<0))throw Error('Invalid, future, unordered or incomplete OHLC source');previous=time;}
 return bars;
}

function features(history,atr){
 const x=history.at(-1),closes=history.map(b=>b.close);let ema=average(closes.slice(0,20));
 for(const close of closes.slice(20))ema+=(close-ema)*2/21;
 const changes=closes.slice(-21).slice(1).map((p,i)=>Math.abs(p-closes.slice(-21)[i])),travel=changes.reduce((s,v)=>s+v,0),utc=new Date(x.time),angle=(utc.getUTCHours()+utc.getUTCMinutes()/60)*Math.PI/12;
 const volumeAvailable=history.slice(-20).every(b=>Number.isFinite(b.volume)&&b.volume>0&&!b.volumeUnavailable),volumeMean=volumeAvailable?average(history.slice(-20).map(b=>b.volume)):null;
 return [(x.close-closes.at(-2))/atr,(x.close-closes.at(-5))/atr,atr/x.close,(x.close-ema)/atr,travel?Math.abs(closes.at(-1)-closes.at(-21))/travel:0,volumeAvailable?Math.log(x.volume/volumeMean):0,volumeAvailable?1:0,(x.close-x.open)/atr,Math.sin(angle),Math.cos(angle)];
}

export function collectIntelligenceExamples(dataset,{asOf=Date.now(),cost=costForSymbol(dataset?.symbol)}={}){
 const bars=validateResearchDataset(dataset,{asOf});if(!validTradingCost(cost))throw Error('Explicit valid research costs required');
 const rows=[],frames=[],busy=new Map(),diagnostics={setups:0,invalidPlans:0,censored:0,contextUnavailable:0};
 for(let i=120;i<bars.length;i++){
  const entryTimeMs=Date.parse(bars[i].time),history=bars.slice(Math.max(0,i-240),i),context=analyzeIntelligenceContext(history,{nowMs:entryTimeMs});
  if(!context.valid||Date.parse(history.at(-1).time)+interval!==entryTimeMs){diagnostics.contextUnavailable++;continue;}
  const base=features(history,context.atr);if(base.some(v=>!Number.isFinite(v)))throw Error('Research features exceed numeric limits');
  frames.push({timeMs:entryTimeMs,features:base});
  for(const rule of intelligenceStrategies){
   if((busy.get(rule.id)??-Infinity)>=entryTimeMs)continue;
   const raw=signalFromIntelligenceContext(context,rule.id);if(raw.side==='HOLD')continue;diagnostics.setups++;
   const plan=makeTradePlan(raw,{price:bars[i].open},cost,{entryTime:entryTimeMs});if(!plan.valid){diagnostics.invalidPlans++;continue;}
   const outcome=labelTradeOutcome(plan,bars.slice(i,i+16));if(outcome.censored){diagnostics.censored++;continue;}
   busy.set(rule.id,outcome.labelEndTimeMs);
   rows.push({id:`${rule.id}:${entryTimeMs}`,strategy:rule.id,side:raw.side,index:i,signal:{side:raw.side,strategy:raw.strategy,entry:raw.entry,stop:raw.stop,target:raw.target,atr:raw.atr},entryTimeMs,labelEndTimeMs:outcome.labelEndTimeMs,y:outcome.y,netR:outcome.netR,status:outcome.status,baseFeatures:base});
  }
 }
 return {bars,rows,frames,cost,diagnostics};
}

export function partitionIntelligenceRows(rows,{trainEndMs,selectionEndMs,calibrationEndMs,testEndMs}){
 if(![trainEndMs,selectionEndMs,calibrationEndMs,testEndMs].every(Number.isSafeInteger)||!(trainEndMs<selectionEndMs&&selectionEndMs<calibrationEndMs&&calibrationEndMs<testEndMs)||!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r.entryTimeMs)||!Number.isSafeInteger(r.labelEndTimeMs)||r.labelEndTimeMs<r.entryTimeMs))throw Error('Invalid chronological research boundaries');
 const train=[],selection=[],calibration=[],test=[],excluded=[];
 for(const row of rows){
  const start=row.entryTimeMs,end=row.labelEndTimeMs;
  if(start<trainEndMs&&end<trainEndMs)train.push(row);
  else if(start>=trainEndMs+embargo&&start<selectionEndMs&&end<selectionEndMs)selection.push(row);
  else if(start>=selectionEndMs+embargo&&start<calibrationEndMs&&end<calibrationEndMs)calibration.push(row);
  else if(start>=calibrationEndMs+embargo&&end<=testEndMs)test.push(row);
  else excluded.push(row);
 }
 return {train,selection,calibration,test,excluded,embargoMs:embargo,boundaries:{trainEndMs,selectionEndMs,calibrationEndMs,testEndMs}};
}

function modelRows(rows,regimes){
 return rows.map(row=>{const estimate=inferRegime(row.baseFeatures,regimes),regime=estimate.status==='estimated'?estimate.regime:0;
  return {...row,regime,features:[...row.baseFeatures,row.side==='BUY'?1:-1,...intelligenceStrategies.map(r=>r.id===row.strategy?1:0),...Array.from({length:regimes.clusters??1},(_,i)=>i===regime?1:0)]};});
}
function predictions(rows,model){return rows.map(row=>model.algorithm==='strategy-regime-beta-shrinkage'?predictRegimeOutcome(row.strategy,row.regime,model):predictResearchClassifier(row.features,model));}
function strategySummary(rows){return intelligenceStrategies.map(rule=>{const trades=rows.filter(r=>r.strategy===rule.id);return {id:rule.id,name:rule.name,...metrics(trades.map(r=>({r:r.netR}))),target:trades.filter(t=>t.y===1).length,expired:trades.filter(t=>t.status==='expired').length};});}
function stressFrozenSetups(rows,bars,cost){
 return [1,1.5,2].map(multiplier=>{const stressed={...cost,feeBps:cost.feeBps*multiplier,slippageBps:cost.slippageBps*multiplier,feePerUnit:(cost.feePerUnit??0)*multiplier},outcomes=[];let invalidPlans=0,censored=0;
  for(const row of rows){const plan=makeTradePlan(row.signal,{price:bars[row.index].open},stressed,{entryTime:row.entryTimeMs});if(!plan.valid){invalidPlans++;continue;}const result=labelTradeOutcome(plan,bars.slice(row.index,row.index+16));if(result.censored){censored++;continue;}outcomes.push({strategy:row.strategy,netR:result.netR,y:result.y,status:result.status});}
  return {multiplier,cost:stressed,referenceSetups:rows.length,invalidPlans,censored,strategies:strategySummary(outcomes)};
 });
}
function nextHypotheses(report){
 const ideas=[];
 if(report.drift?.maxPsi>.2)ideas.push({id:'regime-shift',reason:'Feature distributions changed; compare recent and historical calibration before retraining.',kind:'investigate'});
 if(report.status==='insufficient')ideas.push({id:'insufficient-evidence',reason:'Collect independent completed outcomes before comparing or promoting a model.',kind:'evidence'});
 if(report.test?.baseline?.brier!=null&&report.test?.ensemble?.brier>=report.test.baseline.brier)ideas.push({id:'no-predictive-advantage',reason:'The ensemble did not beat the train-prior Brier baseline on the reserved period.',kind:'reject-or-revise'});
 for(const strategy of report.strategies??[])if(strategy.n>=20&&strategy.expectancy<=0)ideas.push({id:`review:${strategy.id}`,reason:'Nonpositive net test expectancy; inspect costs, regime and failed setups rather than enabling this rule.',kind:'strategy-review'});
 return ideas;
}

export function researchIntelligence(dataset,{asOf=Date.now(),cost=costForSymbol(dataset?.symbol),positions=[],equity=10000,predictionHistory=[]}={}){
 const collected=collectIntelligenceExamples(dataset,{asOf,cost}),{bars,rows,frames}=collected,n=bars.length;
 const boundaries={trainEndMs:Date.parse(bars[Math.floor(n*.5)].time),selectionEndMs:Date.parse(bars[Math.floor(n*.7)].time),calibrationEndMs:Date.parse(bars[Math.floor(n*.85)].time),testEndMs:Date.parse(bars.at(-1).time)+interval};
 const rawPartitions=partitionIntelligenceRows(rows,boundaries),fitFrames=frames.filter(f=>f.timeMs<boundaries.trainEndMs).map(f=>f.features),regimes=fitRegimes(fitFrames);
 const decorated=Object.fromEntries(['train','selection','calibration','test'].map(name=>[name,modelRows(rawPartitions[name],regimes)]));
 const reference=fitFrames,current=frames.filter(f=>f.timeMs>=boundaries.calibrationEndMs).map(f=>f.features);
 const returns={[dataset.symbol]:bars.slice(-241).slice(1).flatMap((b,i)=>{const previous=bars.slice(-241)[i];return Date.parse(b.time)-Date.parse(previous.time)===interval?[{timeMs:Date.parse(b.time),value:b.close/previous.close-1}]:[];})};
 const latest=analyzeIntelligenceContext(bars.slice(-240),{nowMs:asOf}),signals=intelligenceStrategies.map(rule=>signalFromIntelligenceContext(latest,rule.id));
 const report={schemaVersion:1,kind:'intelligence-research',version:intelligenceResearchVersion,strategyVersion:intelligenceStrategiesVersion,learnerVersion:researchLearnerVersion,
  source:dataset.source,symbol:dataset.symbol,sourceSha256:sha(dataset),asOf,testOnly:dataset.synthetic===true||dataset.provenance?.syntheticTestOnly===true,status:'insufficient',
  policy:{researchOnly:true,paperPromotion:false,realTradingAuthorized:false,confidenceUnchanged:true,selectionUsesTest:false,entryPolicy:tradeEntryPolicy,embargoMs:embargo,cost,dependence:'Strategies can share timestamps; counts are not independent observations.'},
  bars:n,examples:rows.length,diagnostics:collected.diagnostics,partitions:{...boundaries,counts:Object.fromEntries(Object.entries(decorated).map(([key,value])=>[key,value.length])),excluded:rawPartitions.excluded.length},
  regimes,drift:distributionDrift(reference,current),strategies:strategySummary(decorated.test),latestSetups:signals,
  costStress:{kind:'frozen-base-test-setups',selectionFrozen:true,levelsFrozen:true,reroutesAfterInvalidation:false,scenarios:stressFrozenSetups(decorated.test,bars,cost)},
  portfolio:portfolioRisk(positions,returns,{equity}),allocation:allocateResearchRisk(signals.filter(s=>s.side!=='HOLD').map(s=>({id:s.strategy,symbol:dataset.symbol,side:s.side})),returns),
  externalModelDiagnostics:predictionHistory.length?adaptiveEnsemble(predictionHistory,{asOf}):{status:'insufficient',reason:'no-external-outcome-history'},models:[],hypotheses:[]};
 if(regimes.status!=='fitted'||decorated.train.length<40||new Set(decorated.train.map(r=>r.y)).size<2||decorated.selection.length<20||decorated.calibration.length<20||decorated.test.length<20){report.reason='Separate chronological partitions need at least 40 training, 20 selection, 20 calibration and 20 test outcomes plus two training classes.';report.hypotheses=nextHypotheses(report);return report;}
 const candidates=[.01,.1,1].map(l2=>({id:`logistic-l2-${l2}`,model:fitResearchClassifier(decorated.train,{l2})}));
 candidates.push({id:'regime-beta',model:fitRegimeOutcomeModel(decorated.train)});
 const history=[];
 for(const candidate of candidates){const p=predictions(decorated.selection,candidate.model);candidate.selection=probabilityMetrics(decorated.selection,p);
  for(let i=0;i<p.length;i++)history.push({model:candidate.id,probability:p[i],y:decorated.selection[i].y,labelEndTimeMs:decorated.selection[i].labelEndTimeMs});}
 const ensemble=adaptiveEnsemble(history,{asOf:boundaries.selectionEndMs}),selected=candidates.slice().sort((a,b)=>a.selection.brier-b.selection.brier||a.id.localeCompare(b.id))[0].id;
 if(ensemble.status!=='weighted'){report.reason='Ensemble selection needs more completed validation outcomes.';report.hypotheses=nextHypotheses(report);return report;}
 const predictEnsemble=target=>target.map(row=>candidates.reduce((sum,c)=>sum+(ensemble.weights[c.id]??0)*predictions([row],c.model)[0],0));
 const calibrationProbabilities=predictEnsemble(decorated.calibration),testProbabilities=predictEnsemble(decorated.test),calibration=calibratePredictionSets(decorated.calibration.map((row,i)=>({probability:calibrationProbabilities[i],y:row.y,timeMs:row.labelEndTimeMs})));
 const prior=average(decorated.train.map(row=>row.y)),sets=testProbabilities.map(p=>predictionSet(p,calibration));
 report.status='evaluated';report.selectedOnValidation=selected;report.ensemble=ensemble;report.uncertainty={...calibration,testCoverage:sets[0]?.status==='estimated'?sets.filter((s,i)=>s.labels.includes(decorated.test[i].y)).length/sets.length:null,ambiguous:sets.filter(s=>s.labels?.length!==1).length,testSamples:sets.length};
 report.test={ensemble:probabilityMetrics(decorated.test,testProbabilities),baseline:probabilityMetrics(decorated.test,decorated.test.map(()=>prior)),ensembleNetPerformanceIsNotSimulated:true};
 report.models=candidates.map(c=>({id:c.id,model:c.model,selection:c.selection,test:probabilityMetrics(decorated.test,predictions(decorated.test,c.model))}));
 report.hypotheses=nextHypotheses(report);return report;
}

export function auditPublishedResearch(research,models=[]){
 if(research?.kind!=='independent-strategy-lab'||!Array.isArray(research.results)||!Array.isArray(models))throw Error('Published research report required');
 const profiles=research.results.filter(r=>r.h1Policy==='align-if-available').map(r=>({id:r.id,name:r.name,base:r.stress?.find(c=>c.costMultiplier===1),stressed:r.stress?.find(c=>c.costMultiplier===2)}));
 return {schemaVersion:1,kind:'intelligence-evidence-audit',version:intelligenceResearchVersion,source:research.source,symbol:research.symbol,reportId:research.id,
  historicalStrategies:research.strategies,newResearchStrategies:intelligenceStrategies.map(r=>({id:r.id,name:r.name,status:'implemented-not-historically-validated'})),
  evidence:{profiles:profiles.length,positiveNetProfiles:profiles.filter(r=>Number.isFinite(r.base?.netExpectancyR)&&r.base.netExpectancyR>0).length,negativeOrZeroNetProfiles:profiles.filter(r=>Number.isFinite(r.base?.netExpectancyR)&&r.base.netExpectancyR<=0).length,missingNetProfiles:profiles.filter(r=>!Number.isFinite(r.base?.netExpectancyR)).length},
  models:models.map(m=>({symbol:m.symbol,algorithm:m.algorithm,status:m.publication?.status??'unavailable',paperAuthorized:m.publication?.passed===true,reasons:m.publication?.rejectionReasons??[]})),
  decisions:[{id:'avoid-unvalidated-routing',action:'Keep new strategies in research until chronological evidence is available.'},{id:'compare-regimes-and-costs',action:'Use regime-aware and cost-stressed experiments to investigate losing profiles.'},{id:'measure-model-shift',action:'Evaluate feature drift and prediction uncertainty on a distinct recent period.'}],
  policy:{researchOnly:true,paperPromotion:false,confidenceUnchanged:true,realTradingAuthorized:false}};
}
