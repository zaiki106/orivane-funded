// Intraday adaptations with fixed filters; no learned or claimed success rate.
export function pricePatternContext(bars){
  const x=bars.at(-1),p=bars.at(-2),window=bars.slice(-8,-1),fractal=bars.slice(-6,-1),pivot=fractal[2];
  const consecutive=rows=>rows.every((bar,i)=>!i||Date.parse(bar.time)-Date.parse(rows[i-1].time)===900000);
  const pivotReady=fractal.length===5&&consecutive(bars.slice(-6));
  const priorChannel=bars.slice(-22,-2);
  return {fractalHigh:pivotReady&&fractal.every((bar,i)=>i===2||pivot.high>bar.high)?pivot.high:null,
    fractalLow:pivotReady&&fractal.every((bar,i)=>i===2||pivot.low<bar.low)?pivot.low:null,
    failedBreakHigh:priorChannel.length===20&&consecutive(bars.slice(-22))?Math.max(...priorChannel.map(bar=>bar.high)):null,
    failedBreakLow:priorChannel.length===20&&consecutive(bars.slice(-22))?Math.min(...priorChannel.map(bar=>bar.low)):null,
    threeBarContiguous:consecutive(bars.slice(-3)),pullbackFirst:bars.at(-3),
    twoBarContiguous:Date.parse(x.time)-Date.parse(p.time)===900000,
    previousNr7:window.length===7&&window.every((bar,i)=>!i||Date.parse(bar.time)-Date.parse(window[i-1].time)===900000)&&p.high>p.low&&window.slice(0,-1).every(bar=>p.high-p.low<bar.high-bar.low),
    currentNr7:bars.slice(-7).every((bar,i,a)=>!i||Date.parse(bar.time)-Date.parse(a[i-1].time)===900000)&&x.high>x.low&&bars.slice(-7,-1).every(bar=>x.high-x.low<bar.high-bar.low)};
}
export function pricePatternChecks(q,id){
  const x=q.last,p=q.previous,bull=x.close>x.open,bear=x.close<x.open;
  const c=(label,passed)=>({label,passed:Boolean(passed)});
  const trendBuy=q.e21>q.e50&&q.e21>q.previousE21&&x.close>q.e21;
  const trendSell=q.e21<q.e50&&q.e21<q.previousE21&&x.close<q.e21;
  const common=[c('Deux bougies 15 min consécutives',q.twoBarContiguous),c('Corps courant ≥ 0,25 ATR',Math.abs(x.close-x.open)>=.25*q.atr)];
  if(id==='two-bar-pullback'){
    const first=q.pullbackFirst;
    return {
      BUY:[...common,c('Trois bougies consécutives',q.threeBarContiguous),c('Deux corps baissiers de repli',first?.close<first?.open&&p.close<p.open),c('Repli touche EMA 21 précédente',Math.min(first?.low??Infinity,p.low)<=q.previousE21),c('Reprise au-dessus des deux sommets',bull&&x.close>Math.max(first?.high??Infinity,p.high)),c('Tendance EMA 21/50 haussière',trendBuy)],
      SELL:[...common,c('Trois bougies consécutives',q.threeBarContiguous),c('Deux corps haussiers de repli',first?.close>first?.open&&p.close>p.open),c('Repli touche EMA 21 précédente',Math.max(first?.high??-Infinity,p.high)>=q.previousE21),c('Reprise sous les deux creux',bear&&x.close<Math.min(first?.low??-Infinity,p.low)),c('Tendance EMA 21/50 baissière',trendSell)]};
  }
  if(id==='fractal-breakout')return {
    BUY:[...common,c('Fractale haute stricte confirmée par deux bougies à droite',Number.isFinite(q.fractalHigh)),c('Premier franchissement en clôture de la fractale haute',Number.isFinite(q.fractalHigh)&&p.close<=q.fractalHigh&&x.close>q.fractalHigh),c('Bougie haussière en tendance EMA 21/50',bull&&trendBuy)],
    SELL:[...common,c('Fractale basse stricte confirmée par deux bougies à droite',Number.isFinite(q.fractalLow)),c('Premier franchissement en clôture de la fractale basse',Number.isFinite(q.fractalLow)&&p.close>=q.fractalLow&&x.close<q.fractalLow),c('Bougie baissière en tendance EMA 21/50',bear&&trendSell)]};
  if(id==='failed-breakout')return {
    BUY:[...common,c('Clôture précédente sous le canal 20 antérieur',Number.isFinite(q.failedBreakLow)&&p.close<q.failedBreakLow),c('Réintégration haussière du canal en clôture',Number.isFinite(q.failedBreakLow)&&bull&&x.close>q.failedBreakLow&&x.close<q.failedBreakHigh),c('Direction modérée < 1,2 ATR',q.trend<1.2)],
    SELL:[...common,c('Clôture précédente au-dessus du canal 20 antérieur',Number.isFinite(q.failedBreakHigh)&&p.close>q.failedBreakHigh),c('Réintégration baissière du canal en clôture',Number.isFinite(q.failedBreakHigh)&&bear&&x.close<q.failedBreakHigh&&x.close>q.failedBreakLow),c('Direction modérée < 1,2 ATR',q.trend<1.2)]};
  if(id==='nr7-breakout')return {
    BUY:[...common,c('Bougie précédente strictement la plus étroite sur 7',q.previousNr7),c('Clôture > sommet NR7',x.close>p.high),c('Bougie haussière',bull),c('EMA 21 haussière au-dessus de 50',trendBuy)],
    SELL:[...common,c('Bougie précédente strictement la plus étroite sur 7',q.previousNr7),c('Clôture < creux NR7',x.close<p.low),c('Bougie baissière',bear),c('EMA 21 baissière sous 50',trendSell)]};
  if(id==='engulfing-reclaim')return {
    BUY:[...common,c('Corps baissier précédent englouti strictement',p.close<p.open&&bull&&x.open<=p.close&&x.close>p.open),c('Repli précédent sous EMA 21',p.low<=q.previousE21),c('Reprise EMA 21 en tendance haussière',trendBuy)],
    SELL:[...common,c('Corps haussier précédent englouti strictement',p.close>p.open&&bear&&x.open>=p.close&&x.close<p.open),c('Repli précédent au-dessus EMA 21',p.high>=q.previousE21),c('Reprise EMA 21 en tendance baissière',trendSell)]};
  throw Error('Figure inconnue');
}
