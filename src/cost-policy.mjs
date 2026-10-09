// Per-side simulation assumptions, shared by labels, laboratory and paper execution.
export function costForSymbol(symbol,{profile=process.env.ORIVANE_COST_PROFILE??'generic'}={}){
  const crypto=/^(BTC|ETH)\//.test(symbol??'');
  const generic={feeBps:crypto?10:2,slippageBps:crypto?5:2,assumption:true};
  if(profile==='generic')return generic;
  if(profile!=='the5ers')throw Error('Profil de coûts inconnu');
  const source='https://the5ers.com/faqs/what-are-the-spreads-and-commissions/';
  const common={profile,source,checkedOn:'2026-10-09',assumption:true,spreadIncluded:false,slippageVerified:false};
  if(['EUR/USD','GBP/USD'].includes(symbol))return {...generic,...common,feeBps:0,feePerUnit:2/100000,commissionVerified:true,commissionBasis:'USD-per-base-unit-per-side',contractSize:100000,roundTripCommissionPerLotUSD:4};
  if(symbol==='NDX')return {...generic,...common,feeBps:0,commissionVerified:true,commissionBasis:'no-index-commission',instrumentCaveat:'NDX Yahoo est un indice, pas la cotation CFD The5ers'};
  // Crypto/metals: the public page gives a formula, not a numeric rate.
  return {...generic,...common,commissionVerified:false,commissionBasis:'generic-assumption-rate-unavailable'};
}

export function validTradingCost(cost){return [cost?.feeBps,cost?.slippageBps].every(x=>Number.isFinite(x)&&x>=0&&x<=1000)&&Number.isFinite(cost?.feePerUnit??0)&&(cost?.feePerUnit??0)>=0;}
export function roundTripFee(cost,entry,exit){return (entry+exit)*cost.feeBps/10000+2*(cost.feePerUnit??0);}
export function directionalCostFraction(cost,price){return 2*(cost.feeBps+cost.slippageBps)/10000+2*(cost.feePerUnit??0)/price;}
