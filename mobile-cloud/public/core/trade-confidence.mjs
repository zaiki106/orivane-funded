import {indicators,signal,analysisWindow} from './engine.mjs';
import {higherTimeframe,routeStrategy} from './decision.mjs';
import {costForSymbol,validTradingCost} from './cost-policy.mjs';
import {getStrategy,strategyRegistry,strategyFamilies,strategyDataReady,strategyRegistryVersion} from './strategy-registry.mjs';
import {makeTradePlan,labelTradeOutcome,tradeOutcomeKind,tradeOutcomeVersion,tradeIntervalMs,tradeEntryPolicy,tradeMaxEntryDelayMs} from './trade-outcome.mjs';
import {tradeModelVersion,tradePublicationVersion,predictTradeProbability,validateTradeModel,passesTradeConfidence,confidenceFromProbability,tradeSignalPolicy} from './trade-inference.mjs';
import {stationaryIndices} from './path-risk.mjs';

export const tradeFeatureNames=Object.freeze(['return1Atr','return4Atr','return12Atr','emaFastAtr','emaSlowAtr','rsiCentered','macdHistogramAtr','atrFraction','bandPosition','logVolumeRatio','volumeAvailable','h1Direction','h1Available','efficiency10','choppiness14','regressionSlopeAtr','regressionR2','candleBodyAtr','closeLocation','side','netRR','stopAtr','targetAtr','expiryBars',...strategyFamilies.map(family=>'family:'+family)]);
const finite=Number.isFinite,average=values=>values.length?values.reduce((s,x)=>s+x,0)/values.length:null;
const millis=x=>typeof x==='number'?x:Date.parse(x);
const closed=bars=>bars.filter(b=>b.closed!==false);
function barValid(bar){return bar&&Number.isFinite(Date.parse(bar.time))&&Date.parse(bar.time)%tradeIntervalMs===0&&[bar.open,bar.high,bar.low,bar.close].every(x=>finite(x)&&x>0)&&bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close,bar.high);}
function opposite(side,h1){return h1.available&&(side==='BUY'&&h1.direction==='DOWN'||side==='SELL'&&h1.direction==='UP');}

export function tradeFeatures(bars,raw,plan,{context=null,h1=null}={}){
 const b=closed(bars).slice(-analysisWindow),q=context??indicators(b),last=b.at(-1),a=q?.advanced,rule=getStrategy(raw?.strategy),higher=h1??higherTimeframe(b);
 if(b.length<60||!q||q.atr<=0||!rule||!plan?.valid||!last)return null;
 const x=last.close,atr=q.atr,dir=raw.side==='BUY'?1:raw.side==='SELL'?-1:0;
 const values=[(x-b.at(-2).close)/atr,(x-b.at(-5).close)/atr,(x-b.at(-13).close)/atr,(q.e9-q.e21)/atr,(q.e21-q.e50)/atr,(q.rsi-50)/50,(q.macd-q.macdSignal)/atr,atr/x,(x-q.mean)/Math.max(2*q.sd,atr*.1),q.hasVolume?Math.log1p(q.volumeRatio)-Math.log(2):0,q.hasVolume?1:0,higher.available?(higher.direction==='UP'?1:higher.direction==='DOWN'?-1:0):0,higher.available?1:0,a?.efficiency??0,finite(a?.chop)?a.chop/100:0,(a?.regression?.slope??0)/atr,a?.regression?.r2??0,(last.close-last.open)/atr,last.high>last.low?(2*last.close-last.high-last.low)/(last.high-last.low):0,dir,plan.netRR,dir*(plan.entry-plan.stop)/atr,dir*(plan.target-plan.entry)/atr,plan.maxBars,...strategyFamilies.map(family=>Number(rule.family===family))];
 return values.length===tradeFeatureNames.length&&values.every(finite)?values:null;
}

export function collectTradeExamples(dataset,{strategyMode='routed',cost,maxBars=16,startIndex=60,endIndex=Infinity,h1Policy='align-if-available'}={}){
 if(!Array.isArray(dataset?.bars)||dataset.timeframe!=null&&dataset.timeframe!==15||typeof dataset.symbol!=='string'||typeof dataset.source!=='string'||!['routed','all'].includes(strategyMode)||!['align-if-available','context-only'].includes(h1Policy)||!Number.isSafeInteger(maxBars)||maxBars<1||maxBars>96)throw Error('Jeu de recherche de trade invalide');
 const bars=closed(dataset.bars),tradingCost=cost??costForSymbol(dataset.symbol,{profile:'the5ers'}),examples=[],rejected={noSetup:0,history:0,h1:0,plan:0,features:0};
 if(!validTradingCost(tradingCost)||bars.some((bar,i)=>!barValid(bar)||i&&Date.parse(bar.time)<=Date.parse(bars[i-1].time)))throw Error('Prix ou coûts de recherche invalides');
 const end=Math.min(bars.length,endIndex),first=Math.max(60,startIndex);
 for(let i=first;i<end;i++){
  const history=bars.slice(Math.max(0,i-240),i),prefix=history.slice(-analysisWindow),q=indicators(prefix),h1=higherTimeframe(history),entryBar=bars[i],entryTimeMs=Date.parse(entryBar.time),featureTimeMs=Date.parse(prefix.at(-1)?.time)+tradeIntervalMs;
  if(!q||featureTimeMs!==entryTimeMs){rejected.history++;continue;}
  const rules=strategyMode==='all'?strategyRegistry:[getStrategy(routeStrategy(history).strategy)].filter(Boolean);
  for(const rule of rules){
   const ready=strategyDataReady(rule,prefix);if(!ready.ready){rejected.history++;continue;}
   const raw=signal(prefix,rule.id,q);if(raw.side==='HOLD'){rejected.noSetup++;continue;}
   if(h1Policy==='align-if-available'&&opposite(raw.side,h1)){rejected.h1++;continue;}
   const plan=makeTradePlan(raw,{price:entryBar.open},tradingCost,{entryTime:entryTimeMs,maxBars});if(!plan.valid){rejected.plan++;continue;}
   const features=tradeFeatures(prefix,raw,plan,{context:q,h1});if(!features){rejected.features++;continue;}
   const outcome=labelTradeOutcome(plan,bars.slice(i,Math.min(bars.length,i+maxBars)),{mode:'ohlc'});
   examples.push({id:dataset.symbol+'|'+entryTimeMs+'|'+rule.id+'|'+raw.side,symbol:dataset.symbol,source:dataset.source,strategy:rule.id,family:rule.family,side:raw.side,
    entryTime:plan.entryTime,entryTimeMs,featureTime:new Date(featureTimeMs).toISOString(),featureTimeMs,features,plan,
    labelEndTime:outcome.labelEndTime??null,labelEndTimeMs:outcome.labelEndTimeMs??null,y:outcome.y,censored:outcome.censored,status:outcome.status,reason:outcome.reason??null,netR:outcome.netR??null,
    outcomeBasis:outcome.basis??'ohlc-last-price',convention:outcome.convention??'stop-first-same-candle',ambiguous:outcome.ambiguous??false,h1Policy});
  }
 }
 const fromMs=Date.parse(bars[0]?.time),toMs=Date.parse(bars.at(-1)?.time)+tradeIntervalMs,n=bars.length;
 const trainEndMs=Date.parse(bars[Math.floor(n*.5)]?.time),calibrationEndMs=Date.parse(bars[Math.floor(n*.75)]?.time);
 return {schema:tradeModelVersion,kind:tradeOutcomeKind,features:[...tradeFeatureNames],examples,metadata:{symbol:dataset.symbol,source:dataset.source,timeframe:15,maxBars,cost:{...tradingCost},strategyMode,h1Policy,outcomeVersion:tradeOutcomeVersion,registryVersion:strategyRegistryVersion,entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,trainingExecution:'next-bar-open-at-boundary',synthetic:dataset.synthetic===true||dataset.provenance?.syntheticTestOnly===true||dataset.quality?.synthetic===true,fromMs,toMs,bars:n,rejected,censored:examples.filter(r=>r.censored).length,split:{trainEndMs,calibrationEndMs,testEndMs:toMs,embargoMs:maxBars*tradeIntervalMs},priceBasis:'ohlc-last-price',publication:false}};
}

export function splitTradeExamples(input,{trainEndMs,calibrationEndMs,testEndMs,embargoMs}={}){
 const rows=Array.isArray(input)?input:input?.examples,defaults=input?.metadata?.split??{};
 trainEndMs??=defaults.trainEndMs;calibrationEndMs??=defaults.calibrationEndMs;testEndMs??=defaults.testEndMs;embargoMs??=defaults.embargoMs??16*tradeIntervalMs;
 if(!Array.isArray(rows)||![trainEndMs,calibrationEndMs,testEndMs,embargoMs].every(finite)||!(trainEndMs<calibrationEndMs&&calibrationEndMs<testEndMs)||embargoMs<0)throw Error('Partitions chronologiques invalides');
 const train=[],calibration=[],test=[],excluded={censored:0,purged:0,invalid:0};
 for(const row of rows){
  if(row?.censored||row?.y==null){excluded.censored++;continue;}
  const start=row.entryTimeMs??millis(row.entryTime),end=row.labelEndTimeMs??millis(row.labelEndTime);
  if(![0,1].includes(row.y)||!finite(start)||!finite(end)||end<start||!Array.isArray(row.features)||row.features.some(v=>!finite(v))||!finite(row.netR)){excluded.invalid++;continue;}
  if(start<trainEndMs&&end<trainEndMs)train.push(row);
  else if(start>=trainEndMs+embargoMs&&start<calibrationEndMs&&end<calibrationEndMs)calibration.push(row);
  else if(start>=calibrationEndMs+embargoMs&&start<testEndMs&&end<=testEndMs)test.push(row);
  else excluded.purged++;
 }
 const sort=(a,b)=>a.entryTimeMs-b.entryTimeMs||String(a.id).localeCompare(String(b.id));
 [train,calibration,test].forEach(part=>part.sort(sort));
 return {train,calibration,test,excluded,boundaries:{trainEndMs,calibrationEndMs,testEndMs,embargoMs},policy:'purged-label-interval-and-max-expiry-embargo'};
}

export function nonOverlappingTradeRows(rows){
 const ordered=rows.slice().sort((a,b)=>a.entryTimeMs-b.entryTimeMs||String(a.id).localeCompare(String(b.id))),busy=new Map(),selected=[];
 for(const row of ordered){
  const key=row.symbol+'|'+row.source,start=row.entryTimeMs,end=row.labelEndTimeMs;
  if(row.censored||![0,1].includes(row.y)||!finite(start)||!finite(end)||end<start||start<=(busy.get(key)??-Infinity))continue;
  selected.push(row);busy.set(key,end);
 }
 return selected;
}
function expectancyInterval(values,{iterations=1000,meanBlock=3,seed=20261014}={}){
 if(values.length<2)return [null,null];
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;},means=[];
 for(let k=0;k<iterations;k++){const indices=values.map(()=>Math.floor(random()*values.length)),uniforms=values.map(()=>random());means.push(average(stationaryIndices(indices,uniforms,1/meanBlock).map(i=>values[i])));}
 means.sort((a,b)=>a-b);return [.025,.975].map(p=>means[Math.floor((means.length-1)*p)]);
}
export function assessTradePublication(rows,{model,baselineProbability,bootstrap={},asOf=Date.now()}={}){
 const context={symbol:model?.symbol,source:model?.source,cost:model?.cost,maxBars:model?.maxBars,outcomeVersion:tradeOutcomeVersion,entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs},base={policyVersion:tradePublicationVersion,kind:tradeOutcomeKind,status:'observation',passed:false,...context};
 if(!Array.isArray(rows)||!finite(baselineProbability)||baselineProbability<0||baselineProbability>1||!Number.isSafeInteger(bootstrap.iterations??1000)||(bootstrap.iterations??1000)<100||(bootstrap.iterations??1000)>2000||!finite(bootstrap.meanBlock??3)||(bootstrap.meanBlock??3)<1||(bootstrap.meanBlock??3)>100||!Number.isSafeInteger(bootstrap.seed??20261014)||(bootstrap.seed??20261014)<0||(bootstrap.seed??20261014)>4294967295)return {...base,reason:'invalid-test-input'};
 const structural=validateTradeModel(model,{...context,asOf,featureNames:tradeFeatureNames});if(!structural.valid)return {...base,reason:structural.reason};
 if(model.entryPolicy!==tradeEntryPolicy||model.maxEntryDelayMs!==tradeMaxEntryDelayMs)return {...base,reason:'model-entry-policy-mismatch'};
 if(rows.some(row=>!row||!Number.isFinite(row.entryTimeMs)||!Number.isFinite(row.labelEndTimeMs)&&!row.censored||!row.censored&&(![0,1].includes(row.y)||!finite(row.netR)||row.labelEndTimeMs<row.entryTimeMs)||row.symbol!==model.symbol||row.source!==model.source))return {...base,reason:'invalid-test-observation'};
 const evaluated=nonOverlappingTradeRows(rows).map(row=>({...row,probability:predictTradeProbability(row.features,model,{...context,asOf:row.entryTimeMs,featureNames:tradeFeatureNames})}));
 if(evaluated.some(row=>!finite(row.probability)||!finite(row.netR)||row.symbol!==model.symbol||row.source!==model.source))return {...base,reason:'invalid-test-observation'};
 const n=evaluated.length,positive=evaluated.filter(row=>row.y===1).length,negative=n-positive,selected=evaluated.filter(row=>passesTradeConfidence(row.probability)),brier=average(evaluated.map(row=>(row.probability-row.y)**2)),baselineBrier=average(evaluated.map(row=>(baselineProbability-row.y)**2)),netExpectancy=average(selected.map(row=>row.netR)),interval=expectancyInterval(selected.map(row=>row.netR),bootstrap),evaluatedThroughMs=evaluated.length?Math.max(...evaluated.map(row=>row.labelEndTimeMs)):null;
 const enough=n>=200&&positive>=40&&negative>=40&&selected.length>=30,edge=finite(brier)&&finite(baselineBrier)&&brier<baselineBrier&&finite(netExpectancy)&&netExpectancy>0&&finite(interval[0])&&interval[0]>0,passed=enough&&edge;
 return {...base,status:passed?'paper':'observation',passed,reason:!enough?'insufficient-out-of-sample-trades':!edge?'unvalidated-trade-edge':null,nonOverlapping:n,positive,negative,aboveThreshold:selected.length,brier,baselineBrier,netExpectancy,expectancyInterval:interval,evaluatedThroughMs,evaluatedThrough:evaluatedThroughMs?new Date(evaluatedThroughMs).toISOString():null,baselineProbability,bootstrap:{iterations:bootstrap.iterations??1000,meanBlock:bootstrap.meanBlock??3,seed:bootstrap.seed??20261014},selectedMetric:'above-60-percent-nonoverlapping-trades',publicationPolicy:'train-only-selection-distinct-calibration-final-test'};
}

export function liveTradeCandidate(bars,{symbol,source,quote,cost,model=null,asOf=Date.now(),fresh=false,executable=false,h1Policy='align-if-available'}={}){
 const b=closed(bars),history=b.slice(-240),time=millis(asOf),tradingCost=cost??costForSymbol(symbol,{profile:'the5ers'}),route=routeStrategy(history),rule=getStrategy(route.strategy),raw=signal(b.slice(-analysisWindow),route.strategy),candidateSide=['BUY','SELL'].includes(raw.side)?raw.side:null,
  unavailable={kind:tradeOutcomeKind,percent:null,event:'Objectif avant stop, avant expiration',horizonBars:16,horizonMinutes:240,horizon:'4h',entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,probability:null,status:'unavailable'};
 const base={...raw,route,higherTimeframe:route.higherTimeframe,candidateSide,side:'HOLD',entry:null,stop:null,target:null,candidateSetup:raw.setup,setup:raw.setup?{...raw.setup,confirmed:false,entry:null,stop:null,target:null}:null,confidence:unavailable,confidenceGate:{...tradeSignalPolicy,passed:false,candidateSide,candidatePercent:null},modelAssessment:{passed:false,status:'observation',reason:'unpublished-trade-model'},executionPlan:null,expiryBars:16,targetVersion:tradeOutcomeVersion};
 if(!candidateSide)return {...base,reason:raw.reason??'Aucune structure terminée'};
 if(b.some(bar=>!barValid(bar)))return {...base,reason:'Bougies de marché invalides'};
 if(!strategyDataReady(rule,b).ready)return {...base,reason:'Historique continu ou volume réel requis par cette stratégie'};
 const closedThrough=Date.parse(b.at(-1)?.time)+tradeIntervalMs;
 if(!finite(time)||closedThrough>time)return {...base,reason:'Bougie future ou non clôturée'};
 if(time-closedThrough>tradeMaxEntryDelayMs)return {...base,confidence:{...unavailable,referenceTime:new Date(closedThrough).toISOString(),horizonEndAt:new Date(closedThrough+16*tradeIntervalMs).toISOString()},reason:!fresh?'Données périmées ou flux interrompu':!executable?'Source indicative, non exécutable':'expired-entry-window',modelAssessment:{passed:false,status:'observation',reason:'expired-entry-window'}};
 const plan=makeTradePlan(raw,quote,tradingCost,{entryTime:closedThrough,executionTime:time,maxBars:16}),features=tradeFeatures(b,raw,plan,{h1:route.higherTimeframe});
 const withPlan={...base,executionPlan:plan,tradeFeatures:features,confidence:{...unavailable,referenceTime:plan.entryTime,horizonEndAt:plan.expiryTime,cost:{...tradingCost}}};
 if(!plan.valid)return {...withPlan,reason:plan.reason};
 if(!fresh)return {...withPlan,reason:'Données périmées ou flux interrompu'};
 if(!executable||!quote)return {...withPlan,reason:'Source indicative, non exécutable'};
 const modelContext={symbol,source,asOf:time,featureNames:tradeFeatureNames,cost:tradingCost,maxBars:16,strategyMode:'routed',h1Policy,registryVersion:strategyRegistryVersion,entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,requirePublication:false},validation=validateTradeModel(model,modelContext);
 if(!validation.valid)return {...withPlan,reason:'Modèle objectif/stop en observation : '+validation.reason,modelAssessment:{passed:false,status:'observation',reason:validation.reason}};
 const probability=predictTradeProbability(features,model,modelContext),percent=confidenceFromProbability(probability),gate=passesTradeConfidence(probability),assessment={passed:true,status:'paper',reason:null,report:model.publication};
 const promotion=validateTradeModel(model,{...modelContext,requirePublication:true});
 const confidence={...withPlan.confidence,probability,percent,status:probability===null?'unavailable':'calibrated',algorithm:model.algorithm,modelVersion:model.schemaVersion,publication:model.publication},confidenceGate={...tradeSignalPolicy,passed:gate,candidateSide,candidatePercent:percent};
 if(!promotion.valid)return {...withPlan,confidence:{...confidence,status:probability===null?'unavailable':'observation'},confidenceGate:{...confidenceGate,passed:false,probabilityPassed:gate},modelAssessment:{passed:false,status:'observation',reason:promotion.reason,report:model.publication??null},reason:'Modèle objectif/stop en observation : '+promotion.reason,filteredByHigherTimeframe:h1Policy==='align-if-available'&&opposite(candidateSide,route.higherTimeframe)};
 const opposed=h1Policy==='align-if-available'&&opposite(candidateSide,route.higherTimeframe),allowed=gate&&fresh&&executable&&!opposed;
 const reason=!fresh?'Données périmées ou flux interrompu':!executable?'Source indicative, non exécutable':opposed?'Tendance H1 opposée au plan':!gate?'Probabilité objectif avant stop ≤ 60 %':'Plan objectif/stop validé';
 return {...withPlan,side:allowed?candidateSide:'HOLD',entry:allowed?plan.entry:null,stop:allowed?plan.stop:null,target:allowed?plan.target:null,setup:allowed?raw.setup:base.setup,confidence,confidenceGate,modelAssessment:assessment,reason,filteredByHigherTimeframe:opposed};
}
