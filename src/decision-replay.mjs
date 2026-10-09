import {decide} from './decision.mjs';
import {exitPrice,metrics} from './engine.mjs';
import {costForSymbol,roundTripFee} from './cost-policy.mjs';

// Frozen model, chronological held-out candles, one position at a time.
// The end-of-test model assessment is deliberately NOT fed back into past decisions.
export function replayDecisions(dataset,model,{costMultiplier=1}={}){
  if(!Number.isFinite(costMultiplier)||costMultiplier<1||costMultiplier>4)throw Error('Scénario de coûts invalide');
  const bars=(dataset.bars??[]).filter(b=>b.closed!==false),interval=900000;
  const baseCost=costForSymbol(dataset.symbol),cost={...baseCost,feeBps:baseCost.feeBps*costMultiplier,slippageBps:baseCost.slippageBps*costMultiplier,...(baseCost.feePerUnit!==undefined?{feePerUnit:baseCost.feePerUnit*costMultiplier}:{})};
  const base={kind:'frozen-model-replay',symbol:dataset.symbol,source:dataset.source,
    from:bars[0]?.time??null,to:bars.at(-1)?.time??null,bars:bars.length,
    cost,costMultiplier,horizonBars:model?.event?.horizonBars??4,
    modelCalibratedThrough:model?.calibratedThrough??null,publicationGateApplied:false,
    assumptions:['OHLC: stop prioritaire si les deux niveaux sont touchés','Spread historique indisponible','Frais et glissement hypothétiques','Aucun remplissage de données manquantes'],
    trades:[],metrics:metrics([]),counts:{evaluated:0,accepted:0,noSetup:0,confidence:0,h1:0,levels:0,price:0,costs:0,model:0,gaps:0,censored:0}};
  const cutoff=Date.parse(model?.calibratedThrough);
  if(model?.status!=='estimate'||!Number.isFinite(cutoff)||model.symbol!==dataset.symbol||model.source!==dataset.source||!Number.isInteger(base.horizonBars)||base.horizonBars<1||base.horizonBars>32)return {...base,status:'unavailable',reason:'Modèle compatible et daté requis'};
  const first=bars.findIndex(b=>Date.parse(b.time)>=cutoff),partition=(model.split?.test?.start??Math.floor(bars.length*.75))+(model.split?.discardedHistory??0);
  if(first<0)return {...base,status:'unavailable',reason:'Aucune bougie postérieure à la calibration'};
  const start=Math.max(60,first,partition),counts=base.counts,trades=base.trades;
  let position=null;
  function finish(bar,out){
    const dir=position.side==='BUY'?1:-1,exit=out.price*(1-dir*base.cost.slippageBps/10000);
    const net=dir*(exit-position.entry)-roundTripFee(base.cost,position.entry,exit);
    trades.push({...position,exit,exitBarTime:bar.time,exitTime:new Date(Date.parse(bar.time)+(out.atOpen?0:interval)).toISOString(),reason:out.reason,r:net/position.riskUnit});
    position=null;
  }
  for(let i=start;i<bars.length;i++){
    const bar=bars[i],previous=bars[i-1],contiguous=Date.parse(bar.time)-Date.parse(previous.time)===interval;
    if(position){
      if(!contiguous){counts.gaps++;counts.censored++;position=null;continue;}
      const expired=Date.parse(bar.time)-Date.parse(position.time)>=base.horizonBars*interval;
      const out=expired?{price:bar.open,reason:'Expiration à '+base.horizonBars*15+' min',atOpen:true}:exitPrice(position,bar);
      if(out)finish(bar,out);
      continue;
    }
    if(!contiguous){counts.gaps++;continue;}
    const decision=decide(bars.slice(0,i),model,{fresh:true,quote:{price:bar.open},symbol:dataset.symbol,cost:base.cost});
    counts.evaluated++;
    if(decision.side==='HOLD'){
      const key=decision.filteredByLevels?'levels':decision.filteredByPrice?'price':decision.filteredByCosts?'costs':decision.filteredByH1?'h1':decision.filteredByConfidence?'confidence':!decision.confidence.classProbs?'model':'noSetup';
      counts[key]++;continue;
    }
    const plan=decision.executionPlan;
    if(!plan?.valid){counts.levels++;continue;}
    counts.accepted++;
    position={side:decision.side,strategy:decision.strategy,signalTime:decision.time,time:bar.time,
      entry:plan.entry,stop:plan.stop,target:plan.target,distance:plan.riskDistance,riskUnit:plan.netRisk,
      directionProbability:decision.confidence.percent,probabilityEvent:'market_class_probability',netRR:plan.netRR};
    const out=exitPrice(position,bar);if(out)finish(bar,out);
  }
  if(position)counts.censored++;
  return {...base,status:trades.length>=20?'ready':'insufficient',
    reason:trades.length>=20?'Replay historique du moteur, distinct du suivi en direct':'Moins de 20 trades clôturés dans ce replay',
    periodStart:bars[start]?.time??null,metrics:metrics(trades),openPlan:position};
}
