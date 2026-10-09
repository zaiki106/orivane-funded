// Per-side simulation assumptions, shared by labels, laboratory and paper execution.
export function costForSymbol(symbol){
  const crypto=/^(BTC|ETH)\//.test(symbol??'');
  return {feeBps:crypto?10:2,slippageBps:crypto?5:2,assumption:true};
}
