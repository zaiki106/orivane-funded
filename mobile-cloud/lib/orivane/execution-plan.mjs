import {roundTripFee,validTradingCost} from './cost-policy.mjs';
// One immutable stop/target plan shared by closed-bar decisions and replay.
const positive=x=>Number.isFinite(x)&&x>0;
export function executionPlan(signal,quote=null,cost={feeBps:0,slippageBps:0}){
  const direction=signal.side==='BUY'?1:signal.side==='SELL'?-1:0;
  const referenceEntry=signal.entry,stop=signal.stop,target=signal.target,atr=signal.atr;
  const validCost=validTradingCost(cost);
  const invalidStructure=!direction||![referenceEntry,stop,target,atr].every(positive)||direction*(referenceEntry-stop)<=0||direction*(target-referenceEntry)<=0;
  const currentPrice=quote?.price,base=direction===1?(quote?.ask??currentPrice):(quote?.bid??currentPrice);
  const badBook=quote&&([quote.bid,quote.ask].some(x=>x!=null&&!positive(x))||positive(quote.bid)&&positive(quote.ask)&&quote.bid>quote.ask);
  const invalidQuote=Boolean(quote&&(!positive(currentPrice)||!positive(base)||badBook));
  const entry=quote?(invalidQuote||!validCost?null:base*(1+direction*cost.slippageBps/10000)):referenceEntry;
  const stopCrossed=Boolean(quote&&positive(currentPrice)&&direction*(currentPrice-stop)<=0);
  const targetCrossed=Boolean(quote&&positive(currentPrice)&&direction*(target-currentPrice)<=0);
  const levelsCrossed=Boolean(quote&&positive(entry)&&(direction*(entry-stop)<=0||direction*(target-entry)<=0));
  const drifted=Boolean(quote&&positive(entry)&&positive(atr)&&Math.abs(entry-referenceEntry)>.5*atr);
  const exitStop=validCost?stop*(1-direction*cost.slippageBps/10000):null;
  const exitTarget=validCost?target*(1-direction*cost.slippageBps/10000):null;
  const netRisk=positive(entry)&&positive(exitStop)?direction*(entry-exitStop)+roundTripFee(cost,entry,exitStop):null;
  const netReward=positive(entry)&&positive(exitTarget)?direction*(exitTarget-entry)-roundTripFee(cost,entry,exitTarget):null;
  const costsBlocked=!validCost||!positive(netRisk)||!positive(netReward);
  const filteredByLevels=invalidStructure||stopCrossed||targetCrossed||levelsCrossed;
  const filteredByPrice=invalidQuote||drifted;
  const reason=invalidStructure?'Niveaux calculés invalides pour cette bougie':stopCrossed?'Stop déjà franchi par le cours actuel':targetCrossed?'Objectif déjà atteint par le cours actuel':levelsCrossed?'Niveaux invalidés au prix d’entrée courant':invalidQuote?'Cotation actuelle invalide':drifted?'Prix d’entrée courant éloigné de plus de 0,5 ATR du signal':costsBlocked?'Objectif insuffisant après frais et glissement':null;
  return {valid:!filteredByLevels&&!filteredByPrice&&!costsBlocked,reason,referenceEntry,entry,stop,target,
    riskDistance:positive(entry)?direction*(entry-stop):null,netRisk,netReward,
    netRR:positive(netRisk)&&Number.isFinite(netReward)?netReward/netRisk:null,
    entryBasis:quote?(positive(direction===1?quote.ask:quote.bid)?direction===1?'ask':'bid':'last-price'):'signal-close',
    filteredByLevels,filteredByPrice,filteredByCosts:costsBlocked,invalidStructure,cost:{...cost,assumption:true}};
}
