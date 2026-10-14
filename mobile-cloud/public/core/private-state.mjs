import {validateProfile,marketSymbols} from './profile.mjs';
import {validTradingCost,roundTripFee} from './cost-policy.mjs';
import {validTradePlan,tradeOutcomeKind} from './trade-outcome.mjs';
const positive=x=>Number.isFinite(x)&&x>0;
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const time=x=>date(x)&&Date.parse(x)<=Date.now()+60000;
const equal=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
const costKeys=['feeBps','slippageBps','feePerUnit','assumption','profile','source','checkedOn','spreadIncluded','slippageVerified','commissionVerified','commissionBasis','contractSize','roundTripCommissionPerLotUSD','instrumentCaveat'];
const planKeys=['valid','side','strategy','atr','version','kind','referenceEntry','entry','stop','target','netRisk','netReward','riskDistance','netRR','entryTime','entryTimeMs','executionTime','executionTimeMs','entryPolicy','maxEntryDelayMs','expiryTime','expiryTimeMs','maxBars','intervalMs'];
function costSnapshot(cost){
 const keys=costKeys.filter(k=>Object.hasOwn(cost,k));
 if(keys.some(k=>typeof cost[k]==='string'?cost[k].length>2048:typeof cost[k]==='number'?!Number.isFinite(cost[k]):typeof cost[k]!=='boolean'&&cost[k]!=null))throw Error('Métadonnées de coûts invalides');
 return Object.fromEntries(keys.map(k=>[k,cost[k]]));
}
function planSnapshot(plan,record){
 if(!validTradePlan(plan)||plan.side!==record.side||['entry','stop','target'].some(k=>plan[k]!==record[k])||record.netRisk!=null&&plan.netRisk!==record.netRisk||plan.strategy!=null&&record.strategy!=null&&plan.strategy!==record.strategy||record.cost&&['feeBps','slippageBps','feePerUnit'].some(k=>(plan.cost[k]??0)!==(record.cost[k]??0)))throw Error('Plan importé incohérent');
 if(record.referenceTime!=null&&Date.parse(record.referenceTime)!==plan.entryTimeMs||record.horizonEndAt!=null&&Date.parse(record.horizonEndAt)!==plan.expiryTimeMs||record.confidenceKind!=null&&record.confidenceKind!==tradeOutcomeKind)throw Error('Événement objectif/stop importé incohérent');
 return {...Object.fromEntries(planKeys.filter(k=>Object.hasOwn(plan,k)).map(k=>[k,plan[k]])),cost:costSnapshot(plan.cost)};
}
export function validatePrivateImport(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||![undefined,1,2].includes(value.schemaVersion))throw Error('Version du journal incompatible');
 const profile=validateProfile(value.profile),positions=value.positions??[],history=value.history??[],followups=value.followups??[],daily=value.daily??{};
 if(!Array.isArray(positions)||positions.length>5000||!Array.isArray(history)||history.length>500||!Array.isArray(followups)||followups.length>500||!daily||typeof daily!=='object'||Array.isArray(daily))throw Error('Journal trop volumineux ou invalide');
 const ids=new Set();
 const cleaned=positions.map(p=>{
  if(typeof p?.id!=='string'||!p.id||p.id.length>100||ids.has(p.id)||!marketSymbols.includes(p.symbol)||typeof p.source!=='string'||!p.source||p.source.length>200||!['BUY','SELL'].includes(p.side)||!['open','closed'].includes(p.status)||!['paper-device','paper-local'].includes(p.mode)||!time(p.openedAt)||!validTradingCost(p.cost)||![p.entry,p.stop,p.target,p.quantity,p.netRisk].every(positive))throw Error('Position paper invalide');
  const dir=p.side==='BUY'?1:-1;
  if(dir*(p.entry-p.stop)<=0||dir*(p.target-p.entry)<=0||typeof p.strategy!=='string'||!p.strategy||p.strategy.length>100)throw Error('Niveaux du journal invalides');
  const notional=p.entry*p.quantity,openRisk=p.netRisk*p.quantity;
  // Existing paper sizing caps unlevered notional at the locked initial capital.
  // Validate derived products too: two finite operands can still overflow.
  if(!positive(notional)||!positive(openRisk)||notional>profile.capital+1e-8*Math.max(1,profile.capital)||openRisk>profile.capital*.01+1e-8*Math.max(1,profile.capital))throw Error('Quantité ou exposition importée incohérente');
  const stopExit=p.stop*(1-dir*p.cost.slippageBps/10000),risk=dir*(p.entry-stopExit)+roundTripFee(p.cost,p.entry,stopExit);
  if(!positive(risk)||!equal(p.netRisk,risk))throw Error('Risque importé incohérent');
  if(p.status==='closed'&&(!positive(p.exit)||!Number.isFinite(p.pnl)||!time(p.closedAt)||Date.parse(p.closedAt)<Date.parse(p.openedAt)))throw Error('Résultat paper invalide');
  if(p.status==='closed'&&!equal(p.pnl,(dir*(p.exit-p.entry)-roundTripFee(p.cost,p.entry,p.exit))*p.quantity))throw Error('Résultat importé incohérent');
  ids.add(p.id);
  const result={id:p.id,symbol:p.symbol,source:p.source,strategy:p.strategy,side:p.side,status:p.status,mode:p.mode,openedAt:p.openedAt,
   entry:p.entry,stop:p.stop,target:p.target,quantity:p.quantity,netRisk:p.netRisk,cost:costSnapshot(p.cost),notional,unitRisk:p.netRisk,risk:openRisk};
  if(p.plan){result.plan=planSnapshot(p.plan,p);const executed=result.plan.executionTimeMs??result.plan.entryTimeMs;if(executed>Date.parse(p.openedAt)||Date.parse(p.openedAt)-executed>30000)throw Error('Heure du plan importé incohérente');result.expiryAt=result.plan.expiryTime;}
  if(p.confidencePercent!=null){if(!Number.isFinite(p.confidencePercent)||p.confidencePercent<=60||p.confidencePercent>100)throw Error('Confiance de la position invalide');result.confidencePercent=p.confidencePercent;}
  if(typeof p.confidenceKind==='string'&&p.confidenceKind.length<=100)result.confidenceKind=p.confidenceKind;
  if(p.lastObservationTime!=null){if(!Number.isSafeInteger(p.lastObservationTime)||p.lastObservationTime<Date.parse(p.openedAt)||p.lastObservationTime>Date.now()+1000)throw Error('Heure de cotation importée incohérente');result.lastObservationTime=p.lastObservationTime;}
  for(const key of ['observationGap','expiryObservedLate'])if(p[key]!=null){if(typeof p[key]!=='boolean')throw Error('Diagnostic du journal invalide');result[key]=p[key];}
  for(const key of ['observationSession','streamGeneration'])if(p[key]!=null){if(typeof p[key]!=='string'||!p[key]||p[key].length>200)throw Error('Session de cotation invalide');result[key]=p[key];}
  if(p.status==='closed'){
   Object.assign(result,{exit:p.exit,pnl:p.pnl,closedAt:p.closedAt,reason:String(p.reason??'Import paper').slice(0,200)});
   if(p.outcome!=null){if(!['stop','target','expired','censored'].includes(p.outcome)||p.outcome==='censored'&&p.observationGap!==true)throw Error('Issue du journal invalide');result.outcome=p.outcome;}
   if(p.observedBarrier!=null){if(!['stop','target','expired'].includes(p.observedBarrier)||p.outcome&&p.outcome!=='censored'&&p.observedBarrier!==p.outcome)throw Error('Barrière observée invalide');result.observedBarrier=p.observedBarrier;}
   if(p.outcome==='censored'&&p.observedBarrier==null)throw Error('Barrière censurée manquante');
   if(p.observedExitAt!=null){if(!time(p.observedExitAt)||Date.parse(p.observedExitAt)<Date.parse(p.openedAt))throw Error('Sortie observée invalide');result.observedExitAt=p.observedExitAt;}
  }
  return result;
 });
 const realized=cleaned.filter(p=>p.status==='closed').reduce((sum,p)=>sum+p.pnl,0),risk=cleaned.filter(p=>p.status==='open').reduce((sum,p)=>sum+p.risk,0);
 if(!Number.isFinite(realized)||!Number.isFinite(profile.capital+realized)||!Number.isFinite(risk))throw Error('Totaux du journal non finis');
 function observations(list){
  const observationIds=new Set();
  return list.map(h=>{
   if(!h||typeof h.id!=='string'||!h.id||h.id.length>100||observationIds.has(h.id)||!marketSymbols.includes(h.symbol)||!['BUY','SELL'].includes(h.side)||![h.entry,h.stop,h.target].every(positive)||!Number.isFinite(h.confidencePercent)||h.confidencePercent<=60||h.confidencePercent>100||!time(h.observedAt)||typeof h.source!=='string'||!h.source||h.source.length>200)throw Error('Observation invalide');
   const dir=h.side==='BUY'?1:-1;if(dir*(h.entry-h.stop)<=0||dir*(h.target-h.entry)<=0)throw Error('Niveaux observés incohérents');
   observationIds.add(h.id);
   const keys=['id','type','mode','policy','symbol','source','strategy','strategyName','side','entry','stop','target','confidencePercent','confidenceClass','confidenceKind','signalTime','referenceTime','horizonEndAt','observedAt','status','signalObservedAt','observedPrice','observedBarrier','reason','observationSession','streamGeneration','lastObservationTime'];
   const result=Object.fromEntries(keys.filter(k=>typeof h[k]==='string'||typeof h[k]==='number').map(k=>[k,h[k]]));
   if(h.observedPrice!=null&&!positive(h.observedPrice))throw Error('Prix observé invalide');
   if(h.signalObservedAt!=null&&!time(h.signalObservedAt))throw Error('Heure du signal observé invalide');
   if(h.observationGap!=null){if(typeof h.observationGap!=='boolean')throw Error('Diagnostic du suivi invalide');result.observationGap=h.observationGap;}
   for(const key of ['observationSession','streamGeneration'])if(h[key]!=null&&(typeof h[key]!=='string'||!h[key]||h[key].length>200))throw Error('Session du suivi invalide');
   if(h.lastObservationTime!=null&&(!Number.isSafeInteger(h.lastObservationTime)||h.lastObservationTime<Date.parse(h.signalObservedAt??h.observedAt)||h.lastObservationTime>Date.now()+1000))throw Error('Heure de suivi invalide');
   if(h.observedBarrier!=null&&!['stop','target','expired'].includes(h.observedBarrier)||h.status==='censored'&&(h.observationGap!==true||h.observedBarrier==null))throw Error('Issue du suivi invalide');
   if(h.plan){result.plan=planSnapshot(h.plan,h);const start=Date.parse(h.signalObservedAt??h.observedAt),executed=result.plan.executionTimeMs??result.plan.entryTimeMs;if(executed>start||start-executed>30000)throw Error('Heure du suivi importé incohérente');}
   return result;
  });
 }
 const days=Object.entries(daily);
 // An observed stop gap can leave simulated equity at zero or below zero.
 if(days.length>4000||days.some(([k,v])=>!/^\d{4}-\d\d-\d\d$/.test(k)||!Number.isFinite(v)))throw Error('Historique quotidien invalide');
 return {profile,positions:cleaned,history:observations(history),followups:observations(followups),daily:Object.fromEntries(days)};
}
