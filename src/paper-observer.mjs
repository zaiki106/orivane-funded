import {observeTradeOutcome} from './trade-outcome.mjs';
import {exitQuotePrice} from './execution-plan.mjs';
import {roundTripFee,validTradingCost} from './cost-policy.mjs';
export function paperQuoteUpdates(positions,symbol,source,quote,{now=Date.now()}={}){
  const at=Date.parse(quote?.eventTime??quote?.receivedAt),age=now-at;
  if(!Number.isFinite(at)||age< -1000||age>30000||quote?.transport!=='websocket')return [];
  const updates=[];
  for(const p of positions){if(p.status!=='open'||p.symbol!==symbol||p.source!==source||!Number.isFinite(p.quantity)||p.quantity<=0||at<Date.parse(p.openedAt))continue;
    if(p.lastObservationTime!=null&&at<p.lastObservationTime)continue;
    const start=Date.parse(p.openedAt),last=p.lastObservationTime??start;
    const gap=at-last>30000||Boolean(quote.gap||quote.sequenceGap||quote.streamInterrupted)||
      p.observationSession!=null&&quote.observationSession!=null&&p.observationSession!==quote.observationSession||
      p.streamGeneration!=null&&quote.streamGeneration!=null&&p.streamGeneration!==quote.streamGeneration||
      Number.isFinite(Date.parse(quote.streamConnectedAt))&&Date.parse(quote.streamConnectedAt)>start;
    let outcome;
    // An actual quoted exit can settle the simulated PNL after a data gap.
    // Coverage is evaluated independently: its TP-before-SL label is censored.
    if(quote.bid!=null&&quote.ask!=null&&(!Number.isFinite(quote.bid)||quote.bid<=0||!Number.isFinite(quote.ask)||quote.ask<=0||quote.bid>quote.ask))outcome={status:'censored',censored:true,reason:'invalid-book'};
    else if(p.plan)outcome=observeTradeOutcome(p.plan,{...quote,gap:false,sequenceGap:false},{mode:'quote'});
    else{
      const price=exitQuotePrice(quote,p.side),dir=p.side==='BUY'?1:p.side==='SELL'?-1:0;
      if(price===null||!dir||!validTradingCost(p.cost))continue;
      const stop=dir*(price-p.stop)<=0,target=dir*(price-p.target)>=0,expired=Number.isFinite(Date.parse(p.expiryAt))&&at>=Date.parse(p.expiryAt);
      if(stop||target||expired){const exit=price*(1-dir*p.cost.slippageBps/10000);outcome={status:expired?'expired':stop?'stop':'target',grossExit:price,exit,netPnl:dir*(exit-p.entry)-roundTripFee(p.cost,p.entry,exit)};}
    }
    const observation={lastObservationTime:at,observationGap:Boolean(p.observationGap||gap||outcome?.censored),
      ...(typeof quote.observationSession==='string'?{observationSession:quote.observationSession}:{}),...(typeof quote.streamGeneration==='string'?{streamGeneration:quote.streamGeneration}:{})};
    if(!['stop','target','expired'].includes(outcome?.status)){updates.push({id:p.id,...observation});continue;}
    const pnl=outcome.netPnl*p.quantity;if(!Number.isFinite(outcome.exit)||outcome.exit<=0||!Number.isFinite(pnl)){updates.push({id:p.id,...observation,observationGap:true});continue;}
    updates.push({id:p.id,...observation,status:'closed',exit:outcome.exit,pnl,outcome:observation.observationGap?'censored':outcome.status,observedBarrier:outcome.status,observedPrice:outcome.grossExit,
      reason:observation.observationGap?'Cotation réelle après interruption ; ordre objectif/stop indéterminé':outcome.status==='target'?'Objectif observé':outcome.status==='stop'?'Stop observé':'Expiration observée',closedAt:new Date(now).toISOString(),
      observedExitAt:new Date(at).toISOString(),expiryObservedLate:outcome.expiryObservedLate??false});
  }
  return updates;
}
