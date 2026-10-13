import {signal,strategies,setupTriggers,indicators} from './engine.mjs';
import {featureWindow} from './decision.mjs';

const positive=value=>Number.isFinite(value)&&value>0;
const unique=values=>[...new Set(values.filter(Boolean))];

// Plans are derived once from completed candles. They are conditions, never predictions.
export function buildIdeaSetups(dataset,{signals=null,context=null,now=Date.now()}={}){
  if(!dataset?.symbol||!Array.isArray(dataset.bars))return [];
  const interval=(dataset.timeframe??15)*60000,bars=dataset.bars.filter(bar=>bar.closed!==false&&Date.parse(bar.time)+interval<=now).slice(-featureWindow);
  if(bars.length<60)return [];
  const q=context??indicators(bars),evaluated=signals??strategies.map(strategy=>signal(bars,strategy.id,q)),setups=[];
  for(const result of evaluated){
    if(!positive(result.atr)||!positive(result.rr))continue;
    const triggers=setupTriggers(bars,result.strategy,q);
    for(const side of ['BUY','SELL']){
      const trigger=triggers?.[side];if(!trigger)continue;
      const price=positive(trigger.price)?trigger.price:null;
      const checks=result.directionalChecks?.[side]??(result.readiness?.direction===side||result.side===side?result.checks:[]);
      const prerequisites=trigger.prerequisites??[],blockers=prerequisites.filter(check=>!check.met).map(check=>check.label);
      setups.push({id:dataset.symbol+':'+result.strategy+':'+side,symbol:dataset.symbol,strategy:result.strategy,
        strategyName:result.strategyName??strategies.find(strategy=>strategy.id===result.strategy)?.name??result.strategy,
        side,source:dataset.source,timeframe:dataset.timeframe??15,asOf:bars.at(-1).time,
        referenceClosedAt:new Date(Date.parse(bars.at(-1).time)+interval).toISOString(),
        confirmationAt:new Date(Date.parse(bars.at(-1).time)+2*interval).toISOString(),lastClosedChecksAt:bars.at(-1).time,
        trigger:price,entryTrigger:price,stop:null,target:null,
        rr:result.rr,atr:result.atr,riskModel:result.riskModel??'atr',riskProvisional:true,
        riskBasis:'Niveaux calculés uniquement après confirmation sur la prochaine bougie clôturée',
        triggerLabel:['sweep_reclaim','sweep_reject'].includes(trigger.mode)?'Repère du canal':'Clôture à franchir',
        triggerMode:trigger.mode??'conditional',referencePrice:positive(trigger.referencePrice)?trigger.referencePrice:null,
        requiresClose:true,condition:trigger.condition??'Confirmation en clôture requise',blockingReasons:blockers,prerequisites,lastClosedChecks:checks,
        evaluatedSide:result.side,confirmedPlan:result.side===side?{entry:result.entry,stop:result.stop,target:result.target}:null});
    }
  }
  return setups;
}

// Distance ranks nearby price levels. It is neither a win rate nor a vote of strategies.
export function rankIdeas(setups,{quote=null,decision=null,live=false,isFresh=false,now=Date.now(),limit=3}={}){
  if(!isFresh)return [];
  const quoteTime=quote?.receivedAt??null,price=positive(quote?.price)?quote.price:null,quoteAgeMs=quoteTime?Math.max(0,now-Date.parse(quoteTime)):null;
  const ranked=setups.map(setup=>{
    const h1=decision?.route?.higherTimeframe,opposedH1=Boolean(h1?.available&&(setup.side==='BUY'&&h1.direction==='DOWN'||setup.side==='SELL'&&h1.direction==='UP')),
      direction=setup.side==='BUY'?1:-1,routed=decision?.side===setup.side&&decision.strategy===setup.strategy,
      validPlan=routed&&[decision.entry,decision.stop,decision.target].every(positive)&&direction*(decision.entry-decision.stop)>0&&direction*(decision.target-decision.entry)>0,
      confirmed=Boolean(validPlan&&!opposedH1);
    // The router evaluates a bounded history. Its confirmed plan is authoritative.
    const plan=confirmed?{entry:decision.entry??setup.confirmedPlan?.entry,stop:decision.stop??setup.confirmedPlan?.stop,target:decision.target??setup.confirmedPlan?.target}:null,
      trigger=positive(plan?.entry)?plan.entry:setup.trigger,
      stop=positive(plan?.stop)?plan.stop:setup.stop,target=positive(plan?.target)?plan.target:setup.target,
      distanceToTriggerATR=price!==null&&positive(trigger)?Math.abs(price-trigger)/setup.atr:null;
    let blockingReasons=confirmed?[]:[...setup.blockingReasons];
    if(opposedH1)blockingReasons.unshift('Tendance H1 opposée à ce scénario');
    else if((decision?.filteredByLevels||decision?.filteredByPrice)&&decision.strategy===setup.strategy&&decision.confidenceGate?.candidateSide===setup.side)blockingReasons.unshift(decision.reason);
    else if(decision?.filteredByConfidence&&decision.strategy===setup.strategy&&decision.confidenceGate?.candidateSide===setup.side)blockingReasons.unshift(decision.reason);
    else if(decision?.side==='HOLD'&&['pending','error','unvalidated'].includes(decision.confidence?.status))blockingReasons.unshift(decision.reason);
    else if(setup.evaluatedSide===setup.side&&decision?.strategy!==setup.strategy)blockingReasons.unshift('Dernière clôture : autre règle retenue par le routeur');
    if(!confirmed){blockingReasons.push(setup.condition,'Confirmation en clôture et confiance directionnelle > 60 % requises');}
    const {confirmedPlan,evaluatedSide,...publicSetup}=setup;
    return {...publicSetup,trigger,entryTrigger:trigger,stop:confirmed?stop:null,target:confirmed?target:null,riskProvisional:!confirmed,opposedH1,
      confirmationAt:confirmed?setup.referenceClosedAt:setup.confirmationAt,
      riskBasis:confirmed?'Niveaux de la règle validée sur bougie clôturée':setup.riskBasis,status:!isFresh?'stale':confirmed?'confirmed':'conditional',
      confirmed,live:Boolean(live&&isFresh),stale:!isFresh,quoteTime,quoteAgeMs,
      ageMs:Math.max(0,now-Date.parse(setup.asOf)-setup.timeframe*60000),
      distanceToTriggerATR,triggerCrossed:price!==null&&positive(trigger)&&!confirmed?
        ['close_above','reentry_above'].includes(setup.triggerMode)?price>trigger:
        ['close_below','reentry_below'].includes(setup.triggerMode)?price<trigger:null:null,
      blockingReasons:unique(blockingReasons)};
  }).filter(idea=>!idea.opposedH1&&(idea.confirmed||(idea.prerequisites??[]).every(check=>check.met)))
    .sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||(a.distanceToTriggerATR??Infinity)-(b.distanceToTriggerATR??Infinity)||a.strategy.localeCompare(b.strategy)||a.side.localeCompare(b.side));
  const seen=new Set();return ranked.filter(idea=>{if(seen.has(idea.strategy))return false;seen.add(idea.strategy);return true;}).slice(0,Math.max(0,Math.min(10,limit)));
}

export function explainHold(dataset,decision,{isFresh=false,now=Date.now()}={}){
  const timeframe=dataset?.timeframe??15,barTime=dataset?.bars?.at(-1)?.time??null,
    lastClosedAt=barTime?new Date(Date.parse(barTime)+timeframe*60000).toISOString():null;
  const blocks=(decision?.checks??[]).filter(check=>!check.passed).map(check=>check.label);
  if(!isFresh||decision?.filteredByH1||decision?.filteredByConfidence||decision?.filteredByLevels||decision?.filteredByPrice||decision?.filteredByModelEvidence||['pending','error','unvalidated'].includes(decision?.confidence?.status))blocks.unshift(decision?.reason);
  return {reason:decision?.reason??'Données indisponibles',lastClosedBarAt:barTime,lastClosedAt,
    nextCloseAt:isFresh?new Date((Math.floor(now/(timeframe*60000))+1)*timeframe*60000).toISOString():null,
    requiresClose:true,timeframe,blocks:unique(blocks),dataMode:decision?.dataMode??'unavailable'};
}
