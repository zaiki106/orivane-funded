import {pricePatternContext,pricePatternChecks} from './price-patterns.mjs';
import {executionPlan} from './execution-plan.mjs';
import {costForSymbol,roundTripFee} from './cost-policy.mjs';

export const analysisWindow=160;
export const strategies = [
  {id:'breakout-retest',name:'Donchian breakout retest',description:'Cassure clôturée du canal 20 antérieur, retest maintenu puis nouvelle clôture de confirmation ; EMA 21/50 alignées et corps ≥ 0,25 ATR.'},
  {id:'two-bar-pullback',name:'Two-bar pullback reclaim',description:'Deux corps de repli opposés à la tendance EMA 21/50, toucher EMA 21 puis rupture des deux extrêmes en clôture ; trois bougies consécutives et corps ≥ 0,25 ATR.'},
  {id:'fractal-breakout',name:'Confirmed fractal breakout',description:'Pivot strict sur 5 bougies terminé avant le signal, confirmé par deux bougies à droite ; premier franchissement en clôture, EMA 21/50 et corps ≥ 0,25 ATR.'},
  {id:'failed-breakout',name:'Failed breakout recovery',description:'Clôture précédente hors du canal des 20 bougies antérieures, puis réintégration directionnelle en clôture ; corps ≥ 0,25 ATR et régime modéré < 1,2 ATR.'},
  {id:'nr7-breakout',name:'NR7 breakout · 15m',description:'Adaptation intraday NR7 : amplitude précédente strictement minimale sur 7 bougies consécutives, cassure en clôture, corps ≥ 0,25 ATR et EMA 21/50 directionnelles.'},
  {id:'engulfing-reclaim',name:'Engulfing trend reclaim',description:'Corps opposé englouti avec dépassement strict, repli puis reprise EMA 21 dans la tendance EMA 21/50 ; corps ≥ 0,25 ATR et bougies 15m consécutives.'},
  {id:'pullback',name:'Trend pullback',description:'EMA 9/21/50 alignées, repli puis rupture de la bougie de repli.'},
  {id:'breakout',name:'Range breakout',description:'Clôture hors du canal précédent de 20 bougies, expansion et volume si fourni.'},
  {id:'reversion',name:'Band reversion',description:'Réintégration des bandes de Bollinger 20/2 après un excès, en régime peu directionnel.'},
  {id:'ema-cross',name:'EMA crossover',description:'Croisement EMA 9/21, filtre de tendance EMA 50 et bougie de confirmation.'},
  {id:'macd',name:'MACD momentum',description:'Croisement MACD 12/26 avec son signal EMA 9, filtre EMA 50 et confirmation du prix.'},
  {id:'rsi-recovery',name:'RSI recovery',description:'Sortie du RSI Wilder 14 des zones 30/70, avec rupture de la bougie précédente.'},
  {id:'squeeze',name:'Squeeze breakout',description:'Compression Bollinger dans le quintile bas de 40 observations puis cassure avec expansion.'},
  {id:'vwap',name:'Rolling VWAP',description:'Repli et reprise autour du prix typique pondéré par le volume des 20 dernières bougies.'},
  {id:'supertrend',name:'Supertrend continuation',description:'Supertrend Wilder ATR 10 × 3, rupture de la bougie précédente et corps directionnel.'},
  {id:'stochastic',name:'Stochastic reversal',description:'Stochastique rapide 14/3 en sortie de zone 20/80, momentum confirmé par %D et le prix.'},
  {id:'inside-bar',name:'Inside-bar breakout',description:'Bougie intérieure stricte puis clôture hors de la bougie mère, sur trois bougies consécutives.'},
  {id:'liquidity-sweep',name:'Liquidity sweep',description:'Mèche hors du canal Donchian précédent puis rejet dans le canal ; aucun carnet de liquidité supposé.'},
  {id:'continuation',name:'Trend continuation',description:'EMA 9/21/50 alignées, corps directionnel et clôture près de l’extrémité sans attendre un nouveau croisement.'},
  {id:'keltner-reentry',name:'Keltner re-entry',description:'Retour dans le canal EMA 20 ± 2 ATR 14 après un excès précédent, en régime peu directionnel.'},
  {id:'adx-continuation',name:'ADX continuation',description:'ADX Wilder 14 ≥ 25 non décroissant, DI directionnel, filtre EMA 50 et rupture de la bougie précédente.'},
  {id:'ichimoku',name:'Ichimoku trend',description:'Tenkan 9 / Kijun 26, prix hors du nuage 52 décalé de 26 bougies, comparaison à la clôture t−26 et rupture précédente ; 78 bougies minimum.'},
  {id:'cci-recovery',name:'CCI recovery',description:'CCI 20 sur prix typique et écart absolu moyen (constante 0,015), retour de ±100 en régime modéré ; bougie et clôture directionnelles.'},
  {id:'aroon',name:'Aroon trend',description:'Aroon 25 (bougie courante + 25 précédentes, égalités au plus récent), nouveau croisement, leader ≥ 70 et opposé ≤ 30, filtre EMA 50.'},
  {id:'donchian55',name:'Donchian 55',description:'Clôture hors du canal des 55 bougies strictement précédentes, filtre EMA 50, stop 2 ATR 14 et objectif 2R.'},
  {id:'roc-momentum',name:'ROC momentum',description:'ROC 12 en pourcentage : nouveau franchissement de +0,5 % ou −0,5 %, filtre EMA 50 et corps directionnel. Seuil fixe, sans ajustement sur le test.'},
  {id:'parabolic-sar',name:'Parabolic SAR reversal',description:'SAR de Wilder : accélération 0,02, incrément 0,02, plafond 0,20 ; retournement confirmé par EMA 21 et corps directionnel.'},
  {id:'williams-recovery',name:'Williams %R recovery',description:'Williams %R 14 quitte −80/−20, clôture entre les zones extrêmes et rupture précédente, en régime modéré.'},
  {id:'fisher-recovery',name:'Fisher recovery',description:'Fisher Ehlers 10 sur HL2, lissages 0,33/0,67 puis 0,5 ; retournement depuis ±1 et confirmation du prix.'},
  {id:'trix',name:'TRIX momentum',description:'Variation en pourcentage de la triple EMA 15, nouveau croisement de son signal EMA 9, signe et EMA 50 confirmés.'},
  {id:'tsi',name:'TSI momentum',description:'True Strength Index : variations et variations absolues doublement lissées EMA 25/13, croisement EMA 7 et filtre EMA 50.'},
  {id:'dema-reclaim',name:'DEMA reclaim',description:'DEMA 21 = 2 EMA 21 − EMA de EMA 21 ; nouvelle réintégration, pente et filtre EMA 50.'},
  {id:'chandelier',name:'Chandelier reversal',description:'Franchissement de la sortie Chandelier opposée de la bougie terminée : extrêmes 22 ± 3 ATR Wilder 22, stop structurel courant.'},
  {id:'vortex',name:'Vortex crossover',description:'VI+/VI− 14 : sommes des mouvements croisés high/low divisées par la somme des true ranges ; nouveau croisement et filtre EMA 50.'},
  {id:'kama-reclaim',name:'KAMA reclaim',description:'KAMA ER 10, constantes EMA 2/30 au carré, amorce SMA 10 ; nouvelle réintégration, pente, EMA 50 et corps directionnel.'},
  {id:'ppo',name:'PPO momentum',description:'PPO = 100 × (EMA 12 − EMA 26) / EMA 26 ; nouveau croisement EMA 9, signe, EMA 50 et corps directionnel.'},
  {id:'ultimate-recovery',name:'Ultimate recovery',description:'Ultimate Oscillator 7/14/28 sur pression acheteuse et true range, poids 4/2/1 ; sortie de 30/70, prix confirmé et régime modéré.'},
  {id:'smi',name:'SMI reversal',description:'SMI : distance au milieu du canal 5, deux EMA 3, signal EMA 3 ; croisement depuis ±40, prix confirmé et régime modéré.'},
  {id:'stoch-rsi',name:'Stoch RSI recovery',description:'RSI Wilder 14, position sur 14 RSI, %K SMA 3 et %D SMA 3 ; sortie 20/80, confirmation %D et du prix, régime modéré.'},
  {id:'elder-ray',name:'Elder Ray pullback',description:'Bulls = High − EMA 13, Bears = Low − EMA 13 ; repli de puissance opposée qui se résorbe, pente EMA 13 et corps directionnel.'},
  {id:'demarker',name:'DeMarker recovery',description:'DeMarker 14 : somme des hausses de high / somme des hausses de high et baisses de low ; sortie 0,3/0,7, prix confirmé et régime modéré.'},
  {id:'awesome',name:'Awesome zero cross',description:'Awesome Oscillator : SMA 5 − SMA 34 du prix médian HL2 ; nouveau franchissement de zéro, EMA 50 et corps directionnel.'}
];
export function validateBars(rows,now=Date.now()) {
  if(!Array.isArray(rows))throw Error('Bougies absentes');
  let previous=0;
  return rows.map(b=>{const t=Date.parse(b.time);if(!Number.isFinite(t)||t<=previous||t>now+60000||![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||!Number.isFinite(b.volume)||b.volume<0)throw Error('Bougies invalides, futures ou désordonnées');previous=t;return {...b};});
}
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
function emaSeries(values,n){let value=values[0];const alpha=2/(n+1);return values.map((x,i)=>{if(i)value=alpha*x+(1-alpha)*value;return value;});}
function wilderSeries(values,n){let value=avg(values.slice(0,n));return values.map((x,i)=>{if(i<n-1)return null;if(i>=n)value=(value*(n-1)+x)/n;return value;});}
function band(values){const mean=avg(values),sd=Math.sqrt(avg(values.map(x=>(x-mean)**2)));return {mean,sd,upper:mean+2*sd,lower:mean-2*sd,width:4*sd/mean};}
function rollingVwap(bars){const volume=bars.reduce((sum,b)=>sum+b.volume,0);return volume>0?bars.reduce((sum,b)=>sum+(b.high+b.low+b.close)/3*b.volume,0)/volume:null;}
function supertrendSeries(bars,atr){
  let upper=null,lower=null,line=null,direction=-1;
  return bars.map((bar,i)=>{
    if(atr[i]===null)return null;
    const midpoint=(bar.high+bar.low)/2,basicUpper=midpoint+3*atr[i],basicLower=midpoint-3*atr[i],previousUpper=upper,previousLine=line;
    upper=upper===null||basicUpper<upper||bars[i-1]?.close>upper?basicUpper:upper;
    lower=lower===null||basicLower>lower||bars[i-1]?.close<lower?basicLower:lower;
    if(previousLine===null)direction=-1;
    else if(previousLine===previousUpper)direction=bar.close>upper?1:-1;
    else direction=bar.close<lower?-1:1;
    line=direction===1?lower:upper;return {line,direction,upper,lower};
  });
}
function fastStochastic(bars,end){const window=bars.slice(end-13,end+1),high=Math.max(...window.map(b=>b.high)),low=Math.min(...window.map(b=>b.low));return high===low?50:100*(bars[end].close-low)/(high-low);}
function directionalMovement(bars,range){
  // The first DM observation requires a previous bar. Seed 14 observed
  // transitions, then seed ADX from the first 14 defined DX observations.
  const moves=bars.slice(1).map((bar,i)=>{const up=bar.high-bars[i].high,down=bars[i].low-bar.low;return {plus:up>down&&up>0?up:0,minus:down>up&&down>0?down:0};});
  const tr=wilderSeries(range.slice(1),14),plus=wilderSeries(moves.map(move=>move.plus),14),minus=wilderSeries(moves.map(move=>move.minus),14);
  const diPlus=tr.map((value,i)=>value===null?null:value>0?100*plus[i]/value:0),diMinus=tr.map((value,i)=>value===null?null:value>0?100*minus[i]/value:0);
  const dx=diPlus.slice(13).map((value,i)=>{const other=diMinus[i+13],sum=value+other;return sum>0?100*Math.abs(value-other)/sum:0;}),adx=wilderSeries(dx,14);
  return {adx:adx.at(-1),previousAdx:adx.at(-2),diPlus:diPlus.at(-1),diMinus:diMinus.at(-1),previousDiPlus:diPlus.at(-2),previousDiMinus:diMinus.at(-2)};
}
function midpoint(bars,end,n){if(end<n-1)return null;const window=bars.slice(end-n+1,end+1);return (Math.max(...window.map(bar=>bar.high))+Math.min(...window.map(bar=>bar.low)))/2;}
function ichimoku(bars){
  const end=bars.length-1,source=end-26,tenkan=midpoint(bars,end,9),kijun=midpoint(bars,end,26),spanB=midpoint(bars,source,52);
  const cloudA=spanB===null?null:(midpoint(bars,source,9)+midpoint(bars,source,26))/2;
  return {tenkan,kijun,cloudA,cloudB:spanB,cloudTop:cloudA===null?null:Math.max(cloudA,spanB),cloudBottom:cloudA===null?null:Math.min(cloudA,spanB),cloudSourceTime:spanB===null?null:bars[source].time,chikouReference:bars[source]?.close??null};
}
function cci(bars,end){const values=bars.slice(end-19,end+1).map(bar=>(bar.high+bar.low+bar.close)/3),mean=avg(values),deviation=avg(values.map(value=>Math.abs(value-mean)));return deviation>0?(values.at(-1)-mean)/(.015*deviation):0;}
function aroon(bars,end){
  // A 25-period age ranges from 0 to 25, hence 26 observations.
  const window=bars.slice(end-25,end+1);let high=0,low=0;
  for(let i=1;i<window.length;i++){if(window[i].high>=window[high].high)high=i;if(window[i].low<=window[low].low)low=i;}
  return {up:100*(25-(window.length-1-high))/25,down:100*(25-(window.length-1-low))/25};
}
function parabolicSarSeries(bars){
  // Wilder recursion; seed direction from the first two closes, extreme from
  // those same two candles. A reversal resets AF and uses the prior EP.
  let direction=bars[1].close>bars[0].close?1:-1,acceleration=.02;
  let line=direction===1?Math.min(bars[0].low,bars[1].low):Math.max(bars[0].high,bars[1].high),extreme=direction===1?Math.max(bars[0].high,bars[1].high):Math.min(bars[0].low,bars[1].low);
  return bars.map((bar,i)=>{
    if(i===0)return null;
    if(i>1){
      line+=acceleration*(extreme-line);
      line=direction===1?Math.min(line,bars[i-1].low,bars[i-2].low):Math.max(line,bars[i-1].high,bars[i-2].high);
      if(direction===1?bar.low<line:bar.high>line){
        line=direction===1?Math.max(extreme,bar.high):Math.min(extreme,bar.low);
        direction=-direction;extreme=direction===1?bar.high:bar.low;acceleration=.02;
      }else if(direction===1?bar.high>extreme:bar.low<extreme){extreme=direction===1?bar.high:bar.low;acceleration=Math.min(.2,acceleration+.02);}
    }
    return {line,direction,acceleration,extreme};
  });
}
function fisherSeries(bars){
  const medians=bars.map(bar=>(bar.high+bar.low)/2);let normalized=0,fish=0;
  return medians.map((price,i)=>{
    if(i<9)return null;
    const window=medians.slice(i-9,i+1),high=Math.max(...window),low=Math.min(...window);
    normalized=.66*(high===low?0:(price-low)/(high-low)-.5)+.67*normalized;
    if(normalized>.99)normalized=.999;else if(normalized<-.99)normalized=-.999;
    fish=.5*Math.log((1+normalized)/(1-normalized))+.5*fish;
    return fish;
  });
}
function vortex(bars,range,end){
  let plus=0,minus=0,total=0;
  for(let i=end-13;i<=end;i++){plus+=Math.abs(bars[i].high-bars[i-1].low);minus+=Math.abs(bars[i].low-bars[i-1].high);total+=range[i];}
  return {plus:total>0?plus/total:0,minus:total>0?minus/total:0};
}
function furtherIndicators(bars,range,ema21){
  const closes=bars.map(bar=>bar.close),sar=parabolicSarSeries(bars),fish=fisherSeries(bars),end=bars.length-1;
  const ema15=emaSeries(closes,15),double15=emaSeries(ema15,15),triple15=emaSeries(double15,15),trix=triple15.map((value,i)=>i?100*(value/triple15[i-1]-1):0),trixSignal=emaSeries(trix,9);
  // Seed the first change with zero; EMA seeding otherwise follows the engine's
  // existing first-observation convention throughout the 160-candle window.
  const changes=closes.map((value,i)=>i?value-closes[i-1]:0),signed=emaSeries(emaSeries(changes,25),13),absolute=emaSeries(emaSeries(changes.map(Math.abs),25),13),tsi=signed.map((value,i)=>absolute[i]>0?100*value/absolute[i]:0),tsiSignal=emaSeries(tsi,7),double21=emaSeries(ema21,21),dema=ema21.map((value,i)=>2*value-double21[i]);
  const chandelierAtr=wilderSeries(range,22),chandelier=(index)=>({long:Math.max(...bars.slice(index-21,index+1).map(bar=>bar.high))-3*chandelierAtr[index],short:Math.min(...bars.slice(index-21,index+1).map(bar=>bar.low))+3*chandelierAtr[index]});
  const exits=chandelier(end),previousExits=chandelier(end-1),vi=vortex(bars,range,end),previousVi=vortex(bars,range,end-1);
  return {sar:sar.at(-1).line,previousSar:sar.at(-2).line,sarDirection:sar.at(-1).direction,previousSarDirection:sar.at(-2).direction,sarAcceleration:sar.at(-1).acceleration,sarExtreme:sar.at(-1).extreme,williamsR:fastStochastic(bars,end)-100,previousWilliamsR:fastStochastic(bars,end-1)-100,fisher:fish.at(-1),previousFisher:fish.at(-2),fisherTrigger:fish.at(-2),previousFisherTrigger:fish.at(-3),trix:trix.at(-1),previousTrix:trix.at(-2),trixSignal:trixSignal.at(-1),previousTrixSignal:trixSignal.at(-2),tsi:tsi.at(-1),previousTsi:tsi.at(-2),tsiSignal:tsiSignal.at(-1),previousTsiSignal:tsiSignal.at(-2),dema:dema.at(-1),previousDema:dema.at(-2),chandelierLong:exits.long,chandelierShort:exits.short,previousChandelierLong:previousExits.long,previousChandelierShort:previousExits.short,chandelierAtr:chandelierAtr.at(-1),vortexPlus:vi.plus,vortexMinus:vi.minus,previousVortexPlus:previousVi.plus,previousVortexMinus:previousVi.minus};
}
function emaDefined(values,n){
  const start=values.findIndex(Number.isFinite);if(start<0)return values.map(()=>null);
  return [...Array(start).fill(null),...emaSeries(values.slice(start),n)];
}
function smaDefined(values,n){return values.map((_,i)=>{const window=values.slice(i-n+1,i+1);return i>=n-1&&window.every(Number.isFinite)?avg(window):null;});}
function adaptiveKama(closes){
  let value=avg(closes.slice(0,10));
  return closes.map((close,i)=>{
    if(i<9)return null;if(i===9)return {value,efficiency:0,smoothing:(2/31)**2};
    let volatility=0;for(let j=i-9;j<=i;j++)volatility+=Math.abs(closes[j]-closes[j-1]);
    const efficiency=volatility>0?Math.abs(close-closes[i-10])/volatility:0,smoothing=(efficiency*(2/3-2/31)+2/31)**2;
    value+=smoothing*(close-value);return {value,efficiency,smoothing};
  });
}
function nextIndicators(bars,ema12,ema26,gains,losses){
  const closes=bars.map(bar=>bar.close),end=bars.length-1,kama=adaptiveKama(closes),ppo=ema12.map((value,i)=>100*(value-ema26[i])/ema26[i]),ppoSignal=emaSeries(ppo,9);
  const pressure=bars.map((bar,i)=>bar.close-Math.min(bar.low,bars[i-1]?.close??bar.close)),ranges=bars.map((bar,i)=>Math.max(bar.high,bars[i-1]?.close??bar.close)-Math.min(bar.low,bars[i-1]?.close??bar.close));
  const ultimateAt=index=>{const ratio=n=>{const tr=ranges.slice(index-n+1,index+1).reduce((sum,value)=>sum+value,0);return tr>0?pressure.slice(index-n+1,index+1).reduce((sum,value)=>sum+value,0)/tr:.5;};return 100*(4*ratio(7)+2*ratio(14)+ratio(28))/7;};
  const five=bars.map((bar,i)=>{if(i<4)return null;const window=bars.slice(i-4,i+1),high=Math.max(...window.map(b=>b.high)),low=Math.min(...window.map(b=>b.low));return {range:high-low,relative:bar.close-(high+low)/2};});
  const smoothedRelative=emaDefined(emaDefined(five.map(value=>value?.relative??null),3),3),smoothedRange=emaDefined(emaDefined(five.map(value=>value?.range??null),3),3),smi=smoothedRelative.map((value,i)=>value===null?null:smoothedRange[i]>0?200*value/smoothedRange[i]:0),smiSignal=emaDefined(smi,3);
  const rsi=closes.map((_,i)=>i<14?null:losses[i-1]===0?(gains[i-1]===0?50:100):100-100/(1+gains[i-1]/losses[i-1]));
  const stochRsi=rsi.map((value,i)=>{if(i<27)return null;const window=rsi.slice(i-13,i+1),high=Math.max(...window),low=Math.min(...window);return high>low?100*(value-low)/(high-low):50;}),stochRsiK=smaDefined(stochRsi,3),stochRsiD=smaDefined(stochRsiK,3);
  const elderEma=emaSeries(closes,13),bulls=bars.map((bar,i)=>bar.high-elderEma[i]),bears=bars.map((bar,i)=>bar.low-elderEma[i]);
  const deMax=bars.map((bar,i)=>i?Math.max(0,bar.high-bars[i-1].high):0),deMin=bars.map((bar,i)=>i?Math.max(0,bars[i-1].low-bar.low):0),demarkerAt=index=>{const up=deMax.slice(index-13,index+1).reduce((sum,value)=>sum+value,0),down=deMin.slice(index-13,index+1).reduce((sum,value)=>sum+value,0);return up+down>0?up/(up+down):.5;};
  const medians=bars.map(bar=>(bar.high+bar.low)/2),awesomeAt=index=>avg(medians.slice(index-4,index+1))-avg(medians.slice(index-33,index+1));
  return {kama:kama.at(-1).value,previousKama:kama.at(-2).value,kamaEfficiency:kama.at(-1).efficiency,kamaSmoothing:kama.at(-1).smoothing,ppo:ppo.at(-1),previousPpo:ppo.at(-2),ppoSignal:ppoSignal.at(-1),previousPpoSignal:ppoSignal.at(-2),ultimate:ultimateAt(end),previousUltimate:ultimateAt(end-1),smi:smi.at(-1),previousSmi:smi.at(-2),smiSignal:smiSignal.at(-1),previousSmiSignal:smiSignal.at(-2),stochRsiK:stochRsiK.at(-1),previousStochRsiK:stochRsiK.at(-2),stochRsiD:stochRsiD.at(-1),previousStochRsiD:stochRsiD.at(-2),elderEma:elderEma.at(-1),previousElderEma:elderEma.at(-2),bullsPower:bulls.at(-1),previousBullsPower:bulls.at(-2),bearsPower:bears.at(-1),previousBearsPower:bears.at(-2),demarker:demarkerAt(end),previousDemarker:demarkerAt(end-1),awesome:awesomeAt(end),previousAwesome:awesomeAt(end-1)};
}
const rounded=value=>Number.isFinite(value)?Math.round(value*10000)/10000:null;
export function indicators(bars,{includeForming=false}={}){
  // Only the explicitly provisional API preview opts into the active candle.
  bars=includeForming?bars:bars.filter(bar=>bar.closed!==false);
  if(bars.length<60)return null;
  // Every series stops at the supplied final candle. No centred windows or future bars.
  const b=bars,c=b.map(x=>x.close),last=b.at(-1),previous=b.at(-2),ema9=emaSeries(c,9),ema20=emaSeries(c,20),ema21=emaSeries(c,21),ema50=emaSeries(c,50),ema12=emaSeries(c,12),ema26=emaSeries(c,26);
  const macd=ema12.map((value,i)=>value-ema26[i]),macdSignal=emaSeries(macd,9);
  const range=b.map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-(b[i-1]?.close??x.open)),Math.abs(x.low-(b[i-1]?.close??x.open))));
  const atrSeries=wilderSeries(range,14),changes=c.slice(1).map((x,i)=>x-c[i]),gains=wilderSeries(changes.map(x=>Math.max(x,0)),14),losses=wilderSeries(changes.map(x=>Math.max(-x,0)),14);
  const rs=(gain,loss)=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);
  const currentBand=band(c.slice(-20)),previousBand=band(c.slice(-21,-1));
  const widths=Array.from({length:40},(_,i)=>band(c.slice(c.length-60+i,c.length-40+i)).width).sort((a,b)=>a-b);
  const e9=ema9.at(-1),e21=ema21.at(-1),e50=ema50.at(-1),atr=atrSeries.at(-1),volumeMean=avg(b.slice(-21,-1).map(x=>x.volume));
  const st=supertrendSeries(b,wilderSeries(range,10)),stoch=Array.from({length:4},(_,i)=>fastStochastic(b,b.length-4+i)),mother=b.at(-3),inside=previous.high<mother.high&&previous.low>mother.low,contiguous=Date.parse(last.time)-Date.parse(previous.time)===900000&&Date.parse(previous.time)-Date.parse(mother.time)===900000;
  const ar=aroon(b,b.length-1),previousAr=aroon(b,b.length-2),expanded={...directionalMovement(b,range),...ichimoku(b),...furtherIndicators(b,range,ema21),...nextIndicators(b,ema12,ema26,gains,losses),cci:cci(b,b.length-1),previousCci:cci(b,b.length-2),aroonUp:ar.up,aroonDown:ar.down,previousAroonUp:previousAr.up,previousAroonDown:previousAr.down,donchian55High:Math.max(...b.slice(-56,-1).map(bar=>bar.high)),donchian55Low:Math.min(...b.slice(-56,-1).map(bar=>bar.low)),roc:100*(last.close/c.at(-13)-1),previousRoc:100*(previous.close/c.at(-14)-1),rocBase:c.at(-13)};
  return {...pricePatternContext(b),last,previous,mother,e9,e20:ema20.at(-1),e21,e50,e12:ema12.at(-1),e26:ema26.at(-1),atr,previousAtr:atrSeries.at(-2),...currentBand,previousBand,...expanded,rsi:rs(gains.at(-1),losses.at(-1)),previousRsi:rs(gains.at(-2),losses.at(-2)),gain:gains.at(-1),loss:losses.at(-1),previousGain:gains.at(-2),previousLoss:losses.at(-2),previousE9:ema9.at(-2),previousE20:ema20.at(-2),previousE21:ema21.at(-2),previousE50:ema50.at(-2),previousE12:ema12.at(-2),previousE26:ema26.at(-2),macd:macd.at(-1),macdSignal:macdSignal.at(-1),previousMacd:macd.at(-2),previousMacdSignal:macdSignal.at(-2),squeezeThreshold:widths[Math.floor((widths.length-1)*.2)],vwap:rollingVwap(b.slice(-20)),previousVwap:rollingVwap(b.slice(-21,-1)),trend:Math.abs(e21-e50)/Math.max(atr,1e-9),high:Math.max(...b.slice(-21,-1).map(x=>x.high)),low:Math.min(...b.slice(-21,-1).map(x=>x.low)),volumeRatio:volumeMean>0?last.volume/volumeMean:null,hasVolume:b.slice(-21).every(x=>x.volume>0),supertrend:st.at(-1).line,supertrendDirection:st.at(-1).direction,previousSupertrendDirection:st.at(-2).direction,stochastic:stoch.at(-1),stochasticD:avg(stoch.slice(-3)),previousStochastic:stoch.at(-2),previousStochasticD:avg(stoch.slice(0,3)),insideBar:inside,patternContiguous:contiguous,keltnerUpper:ema20.at(-1)+2*atr,keltnerLower:ema20.at(-1)-2*atr,previousKeltnerUpper:ema20.at(-2)+2*atrSeries.at(-2),previousKeltnerLower:ema20.at(-2)-2*atrSeries.at(-2),recentLow:Math.min(...b.slice(-3).map(x=>x.low)),recentHigh:Math.max(...b.slice(-3).map(x=>x.high))};
}
export function signal(bars,strategy,context=null){
  const definition=strategies.find(s=>s.id===strategy);if(!definition)throw Error('Stratégie inconnue');
  const q=context??indicators(bars),empty={side:'HOLD',score:0,strategy,strategyName:definition.name,checks:[],directionalChecks:{BUY:[],SELL:[]},readiness:{passed:0,total:0,percent:0,direction:null},scoreLabel:'Critères réunis'};
  if(!q)return {...empty,reason:'60 bougies clôturées requises',triggerSummary:'Historique insuffisant'};
  const {last:x,previous:p,e9,e21,e50,atr,trend,rsi}=q;
  if(atr<=0)return {...empty,reason:'Volatilité nulle',triggerSummary:'Volatilité nulle'};
  const check=(label,passed,value)=>({label,passed:Boolean(passed),...(value===undefined?{}:{value:typeof value==='number'?rounded(value):value})});
  let buy=[],sell=[],triggerBuy=p.high,triggerSell=p.low,triggerSummary='Rupture de la bougie précédente';
  const volumeCheck=q.hasVolume?[check('Volume ≥ 1,2 × moyenne 20',q.volumeRatio>=1.2,q.volumeRatio)]:[];
  if(['nr7-breakout','engulfing-reclaim','fractal-breakout','failed-breakout','two-bar-pullback','breakout-retest'].includes(strategy)){
    ({BUY:buy,SELL:sell}=pricePatternChecks(q,strategy));
    triggerSummary=strategy==='breakout-retest'?'Cassure du canal 20 passé · retest tenu · clôture de confirmation':strategy==='two-bar-pullback'?'Deux replis · reprise EMA 21 · rupture des deux extrêmes':strategy==='fractal-breakout'?'Pivot strict déjà confirmé · nouveau franchissement · EMA 21/50':strategy==='failed-breakout'?'Clôture hors canal passé · réintégration directionnelle':strategy==='nr7-breakout'?'NR7 strict · cassure en clôture · tendance EMA 21/50':'Corps opposé englouti · reprise EMA 21 · tendance EMA 21/50';
  }else if(strategy==='pullback'){
    buy=[check('EMA 9 > 21 > 50',e9>e21&&e21>e50),check('Repli vers EMA 9 précédente',p.low<=q.previousE9),check('Clôture > sommet précédent',x.close>p.high,p.high),check('RSI entre 45 et 72',rsi>45&&rsi<72,rsi)];
    sell=[check('EMA 9 < 21 < 50',e9<e21&&e21<e50),check('Repli vers EMA 9 précédente',p.high>=q.previousE9),check('Clôture < creux précédent',x.close<p.low,p.low),check('RSI entre 28 et 55',rsi>28&&rsi<55,rsi)];
    triggerSummary='EMA alignées · rupture du repli · RSI confirmé';
  }else if(strategy==='breakout'){
    buy=[check('Clôture > canal 20 précédent',x.close>q.high,q.high),check('Prix > EMA 21',x.close>e21,e21),check('Amplitude > 0,8 ATR',x.high-x.low>atr*.8,(x.high-x.low)/atr),...volumeCheck];
    sell=[check('Clôture < canal 20 précédent',x.close<q.low,q.low),check('Prix < EMA 21',x.close<e21,e21),check('Amplitude > 0,8 ATR',x.high-x.low>atr*.8,(x.high-x.low)/atr),...volumeCheck];
    triggerBuy=q.high;triggerSell=q.low;triggerSummary='Clôture hors canal 20 · expansion'+(q.hasVolume?' · volume confirmé':' · volume indisponible');
  }else if(strategy==='reversion'){
    buy=[check('Faible direction < 0,65 ATR',trend<.65,trend),check('Clôture précédente sous bande',p.close<q.previousBand.lower,q.previousBand.lower),check('Réintégration haussière',x.close>=q.lower&&x.close>p.close,q.lower),check('RSI < 45',rsi<45,rsi)];
    sell=[check('Faible direction < 0,65 ATR',trend<.65,trend),check('Clôture précédente sur bande',p.close>q.previousBand.upper,q.previousBand.upper),check('Réintégration baissière',x.close<=q.upper&&x.close<p.close,q.upper),check('RSI > 55',rsi>55,rsi)];
    triggerBuy=q.lower;triggerSell=q.upper;triggerSummary='Excès précédent · réintégration Bollinger 20/2';
  }else if(strategy==='ema-cross'){
    buy=[check('Nouveau croisement EMA 9 > 21',q.previousE9<=q.previousE21&&e9>e21),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement EMA 9 < 21',q.previousE9>=q.previousE21&&e9<e21),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=((1-2/22)*q.previousE21-(1-2/10)*q.previousE9)/(2/10-2/22);triggerSummary='Croisement EMA 9/21 · filtre EMA 50';
  }else if(strategy==='macd'){
    buy=[check('Nouveau croisement MACD > signal',q.previousMacd<=q.previousMacdSignal&&q.macd>q.macdSignal),check('Prix > EMA 50',x.close>e50,e50),check('Prix en hausse',x.close>p.close)];
    sell=[check('Nouveau croisement MACD < signal',q.previousMacd>=q.previousMacdSignal&&q.macd<q.macdSignal),check('Prix < EMA 50',x.close<e50,e50),check('Prix en baisse',x.close<p.close)];
    triggerBuy=triggerSell=(q.previousMacdSignal-(1-2/13)*q.previousE12+(1-2/27)*q.previousE26)/(2/13-2/27);triggerSummary='Croisement MACD 12/26/9 · filtre EMA 50';
  }else if(strategy==='rsi-recovery'){
    buy=[check('RSI précédent ≤ 30',q.previousRsi<=30,q.previousRsi),check('RSI repasse entre 30 et 55',rsi>30&&rsi<55,rsi),check('Clôture > sommet précédent',x.close>p.high,p.high)];
    sell=[check('RSI précédent ≥ 70',q.previousRsi>=70,q.previousRsi),check('RSI repasse entre 45 et 70',rsi>45&&rsi<70,rsi),check('Clôture < creux précédent',x.close<p.low,p.low)];
    triggerBuy=Math.max(p.high,p.close+Math.max(0,13*(30/70*q.previousLoss-q.previousGain)));triggerSell=Math.min(p.low,p.close-Math.max(0,13*(30/70*q.previousGain-q.previousLoss)));triggerSummary='Retour RSI hors 30/70 · rupture de confirmation';
  }else if(strategy==='squeeze'){
    const compressed=q.previousBand.width>0&&q.previousBand.width<=q.squeezeThreshold;
    buy=[check('Compression dans le quintile bas',compressed,q.previousBand.width),check('Clôture > bande précédente',x.close>q.previousBand.upper,q.previousBand.upper),check('Amplitude > 0,8 ATR',x.high-x.low>atr*.8,(x.high-x.low)/atr),...volumeCheck];
    sell=[check('Compression dans le quintile bas',compressed,q.previousBand.width),check('Clôture < bande précédente',x.close<q.previousBand.lower,q.previousBand.lower),check('Amplitude > 0,8 ATR',x.high-x.low>atr*.8,(x.high-x.low)/atr),...volumeCheck];
    triggerBuy=q.previousBand.upper;triggerSell=q.previousBand.lower;triggerSummary='Compression 40 observations · rupture Bollinger'+(q.hasVolume?' · volume':'');
  }else if(strategy==='vwap'){
    buy=[check('Volume fourni sur 21 bougies',q.hasVolume),check('Repli vers VWAP 20 précédente',q.previousVwap!==null&&p.low<=q.previousVwap,q.previousVwap),check('Clôture > VWAP 20',q.vwap!==null&&x.close>q.vwap,q.vwap),check('EMA 21 ascendante',e21>q.previousE21),check('Clôture > sommet précédent',x.close>p.high,p.high)];
    sell=[check('Volume fourni sur 21 bougies',q.hasVolume),check('Repli vers VWAP 20 précédente',q.previousVwap!==null&&p.high>=q.previousVwap,q.previousVwap),check('Clôture < VWAP 20',q.vwap!==null&&x.close<q.vwap,q.vwap),check('EMA 21 descendante',e21<q.previousE21),check('Clôture < creux précédent',x.close<p.low,p.low)];
    triggerBuy=Math.max(p.high,q.vwap??p.high);triggerSell=Math.min(p.low,q.vwap??p.low);triggerSummary='VWAP glissante 20 bougies · repli puis reprise';
  }else if(strategy==='supertrend'){
    buy=[check('Supertrend ATR 10 × 3 haussier',q.supertrendDirection===1,q.supertrend),check('Clôture > sommet précédent',x.close>p.high,p.high),check('Corps haussier ≥ 0,25 ATR',x.close-x.open>=atr*.25,(x.close-x.open)/atr)];
    sell=[check('Supertrend ATR 10 × 3 baissier',q.supertrendDirection===-1,q.supertrend),check('Clôture < creux précédent',x.close<p.low,p.low),check('Corps baissier ≥ 0,25 ATR',x.open-x.close>=atr*.25,(x.open-x.close)/atr)];
    triggerSummary='Supertrend confirmé · rupture précédente · corps directionnel';
  }else if(strategy==='stochastic'){
    buy=[check('%K précédent ≤ 20',q.previousStochastic<=20,q.previousStochastic),check('%K repasse entre 20 et 65',q.stochastic>20&&q.stochastic<65,q.stochastic),check('%K > %D',q.stochastic>q.stochasticD,q.stochasticD),check('Clôture en hausse',x.close>p.close),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    sell=[check('%K précédent ≥ 80',q.previousStochastic>=80,q.previousStochastic),check('%K repasse entre 35 et 80',q.stochastic>35&&q.stochastic<80,q.stochastic),check('%K < %D',q.stochastic<q.stochasticD,q.stochasticD),check('Clôture en baisse',x.close<p.close),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    triggerBuy=null;triggerSell=null;triggerSummary='Stochastique rapide 14/3 · retour hors 20/80 · %D confirmé';
  }else if(strategy==='inside-bar'){
    buy=[check('Bougie précédente intérieure stricte',q.insideBar),check('Trois bougies consécutives de 15 min',q.patternContiguous),check('Clôture > sommet mère',x.close>q.mother.high,q.mother.high),check('Amplitude ≥ 0,5 ATR',x.high-x.low>=atr*.5,(x.high-x.low)/atr)];
    sell=[check('Bougie précédente intérieure stricte',q.insideBar),check('Trois bougies consécutives de 15 min',q.patternContiguous),check('Clôture < creux mère',x.close<q.mother.low,q.mother.low),check('Amplitude ≥ 0,5 ATR',x.high-x.low>=atr*.5,(x.high-x.low)/atr)];
    triggerBuy=q.mother.high;triggerSell=q.mother.low;triggerSummary='Bougie intérieure · clôture hors de la mère';
  }else if(strategy==='liquidity-sweep'){
    const body=Math.abs(x.close-x.open),lowerWick=Math.min(x.open,x.close)-x.low,upperWick=x.high-Math.max(x.open,x.close);
    buy=[check('Mèche sous canal 20 précédent',x.low<q.low,q.low),check('Clôture réintègre le canal',x.close>q.low,q.low),check('Bougie haussière et mèche ≥ corps',x.close>x.open&&lowerWick>=body),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    sell=[check('Mèche au-dessus du canal 20 précédent',x.high>q.high,q.high),check('Clôture réintègre le canal',x.close<q.high,q.high),check('Bougie baissière et mèche ≥ corps',x.close<x.open&&upperWick>=body),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    triggerBuy=q.low;triggerSell=q.high;triggerSummary='Balayage du canal passé · mèche de rejet · réintégration';
  }else if(strategy==='continuation'){
    const position=(x.close-x.low)/Math.max(x.high-x.low,1e-9);
    buy=[check('EMA 9 > 21 > 50 et EMA 21 monte',e9>e21&&e21>e50&&e21>q.previousE21),check('Prix > EMA 9 à moins de 1,5 ATR',x.close>e9&&x.close-e9<=atr*1.5,e9),check('Corps haussier ≥ 0,2 ATR',x.close-x.open>=atr*.2,(x.close-x.open)/atr),check('Clôture dans le tiers supérieur',position>=.65,position),check('RSI entre 50 et 78',rsi>50&&rsi<78,rsi)];
    sell=[check('EMA 9 < 21 < 50 et EMA 21 baisse',e9<e21&&e21<e50&&e21<q.previousE21),check('Prix < EMA 9 à moins de 1,5 ATR',x.close<e9&&e9-x.close<=atr*1.5,e9),check('Corps baissier ≥ 0,2 ATR',x.open-x.close>=atr*.2,(x.open-x.close)/atr),check('Clôture dans le tiers inférieur',position<=.35,position),check('RSI entre 22 et 50',rsi>22&&rsi<50,rsi)];
    triggerBuy=null;triggerSell=null;triggerSummary='Tendance persistante · corps ≥ 0,2 ATR · clôture directionnelle';
  }else if(strategy==='keltner-reentry'){
    buy=[check('Clôture précédente sous Keltner',p.close<q.previousKeltnerLower,q.previousKeltnerLower),check('Clôture réintègre la bande basse',x.close>=q.keltnerLower,q.keltnerLower),check('Bougie haussière',x.close>x.open),check('RSI < 50',rsi<50,rsi),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    sell=[check('Clôture précédente au-dessus Keltner',p.close>q.previousKeltnerUpper,q.previousKeltnerUpper),check('Clôture réintègre la bande haute',x.close<=q.keltnerUpper,q.keltnerUpper),check('Bougie baissière',x.close<x.open),check('RSI > 50',rsi>50,rsi),check('Direction modérée < 1,2 ATR',trend<1.2,trend)];
    triggerBuy=null;triggerSell=null;triggerSummary='Canal EMA 20 ± 2 ATR 14 · excès puis réintégration';
  }else if(strategy==='adx-continuation'){
    const strength=check('ADX Wilder 14 ≥ 25 et non décroissant',q.adx>=25&&q.adx>=q.previousAdx,q.adx);
    buy=[strength,check('DI+ > DI−',q.diPlus>q.diMinus,q.diPlus),check('Clôture > EMA 50',x.close>e50,e50),check('Clôture > sommet précédent',x.close>p.high,p.high)];
    sell=[strength,check('DI− > DI+',q.diMinus>q.diPlus,q.diMinus),check('Clôture < EMA 50',x.close<e50,e50),check('Clôture < creux précédent',x.close<p.low,p.low)];
    triggerBuy=null;triggerSell=null;triggerSummary='ADX 14 ≥ 25 non décroissant · DI directionnel · EMA 50 · rupture précédente';
  }else if(strategy==='ichimoku'){
    const known=check('Nuage 52 décalé de 26 disponible',Number.isFinite(q.cloudA)&&Number.isFinite(q.cloudB));
    buy=[known,check('Tenkan 9 > Kijun 26',q.tenkan>q.kijun),check('Clôture au-dessus du nuage visible',Number.isFinite(q.cloudTop)&&x.close>q.cloudTop,q.cloudTop),check('Clôture > clôture t−26',x.close>q.chikouReference,q.chikouReference),check('Clôture > sommet précédent',x.close>p.high,p.high)];
    sell=[known,check('Tenkan 9 < Kijun 26',q.tenkan<q.kijun),check('Clôture sous le nuage visible',Number.isFinite(q.cloudBottom)&&x.close<q.cloudBottom,q.cloudBottom),check('Clôture < clôture t−26',x.close<q.chikouReference,q.chikouReference),check('Clôture < creux précédent',x.close<p.low,p.low)];
    triggerBuy=null;triggerSell=null;triggerSummary='Ichimoku 9/26/52 · nuage visible issu de t−26 · rupture précédente';
  }else if(strategy==='cci-recovery'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('CCI précédent ≤ −100',q.previousCci<=-100,q.previousCci),check('CCI repasse entre −100 et 100',q.cci>-100&&q.cci<100,q.cci),check('Bougie haussière et clôture en hausse',x.close>x.open&&x.close>p.close),regime];
    sell=[check('CCI précédent ≥ 100',q.previousCci>=100,q.previousCci),check('CCI repasse entre −100 et 100',q.cci>-100&&q.cci<100,q.cci),check('Bougie baissière et clôture en baisse',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=null;triggerSell=null;triggerSummary='CCI 20 revient de ±100 · prix typique · direction modérée';
  }else if(strategy==='aroon'){
    buy=[check('Nouveau croisement Aroon Up > Down',q.previousAroonUp<=q.previousAroonDown&&q.aroonUp>q.aroonDown),check('Aroon Up ≥ 70 et Down ≤ 30',q.aroonUp>=70&&q.aroonDown<=30,q.aroonUp),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement Aroon Down > Up',q.previousAroonDown<=q.previousAroonUp&&q.aroonDown>q.aroonUp),check('Aroon Down ≥ 70 et Up ≤ 30',q.aroonDown>=70&&q.aroonUp<=30,q.aroonDown),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=null;triggerSell=null;triggerSummary='Aroon 25 · nouveau croisement · leader ≥ 70 et opposé ≤ 30 · EMA 50';
  }else if(strategy==='donchian55'){
    buy=[check('Clôture > canal 55 strictement précédent',x.close>q.donchian55High,q.donchian55High),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Clôture < canal 55 strictement précédent',x.close<q.donchian55Low,q.donchian55Low),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=q.donchian55High;triggerSell=q.donchian55Low;triggerSummary='Canal 55 passé · EMA 50 · stop 2 ATR · objectif 2R';
  }else if(strategy==='roc-momentum'){
    buy=[check('ROC 12 franchit +0,5 %',q.previousRoc<=.5&&q.roc>.5,q.roc),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('ROC 12 franchit −0,5 %',q.previousRoc>=-.5&&q.roc<-.5,q.roc),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=q.rocBase*1.005;triggerSell=q.rocBase*.995;triggerSummary='ROC 12 · nouveau franchissement ±0,5 % · EMA 50 · corps directionnel';
  }else if(strategy==='parabolic-sar'){
    buy=[check('SAR passe de baissier à haussier',q.previousSarDirection===-1&&q.sarDirection===1,q.sar),check('Clôture > SAR et EMA 21',x.close>q.sar&&x.close>e21,e21),check('Bougie haussière',x.close>x.open)];
    sell=[check('SAR passe de haussier à baissier',q.previousSarDirection===1&&q.sarDirection===-1,q.sar),check('Clôture < SAR et EMA 21',x.close<q.sar&&x.close<e21,e21),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='Retournement SAR Wilder 0,02 / 0,20 · EMA 21 · corps directionnel';
  }else if(strategy==='williams-recovery'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('%R précédent ≤ −80',q.previousWilliamsR<=-80,q.previousWilliamsR),check('%R revient entre −80 et −20',q.williamsR>-80&&q.williamsR<-20,q.williamsR),check('Clôture > sommet précédent',x.close>p.high,p.high),regime];
    sell=[check('%R précédent ≥ −20',q.previousWilliamsR>=-20,q.previousWilliamsR),check('%R revient entre −80 et −20',q.williamsR>-80&&q.williamsR<-20,q.williamsR),check('Clôture < creux précédent',x.close<p.low,p.low),regime];
    triggerBuy=triggerSell=null;triggerSummary='Williams %R 14 · sortie des zones −80/−20 · rupture précédente';
  }else if(strategy==='fisher-recovery'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('Fisher précédent ≤ −1',q.previousFisher<=-1,q.previousFisher),check('Nouveau retournement Fisher > retard 1',q.previousFisher<=q.previousFisherTrigger&&q.fisher>q.fisherTrigger,q.fisher),check('Bougie et clôture haussières',x.close>x.open&&x.close>p.close),regime];
    sell=[check('Fisher précédent ≥ 1',q.previousFisher>=1,q.previousFisher),check('Nouveau retournement Fisher < retard 1',q.previousFisher>=q.previousFisherTrigger&&q.fisher<q.fisherTrigger,q.fisher),check('Bougie et clôture baissières',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=triggerSell=null;triggerSummary='Fisher Ehlers 10 · premier retournement depuis ±1 · prix confirmé';
  }else if(strategy==='trix'){
    buy=[check('Nouveau croisement TRIX > signal EMA 9',q.previousTrix<=q.previousTrixSignal&&q.trix>q.trixSignal),check('TRIX > 0',q.trix>0,q.trix),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement TRIX < signal EMA 9',q.previousTrix>=q.previousTrixSignal&&q.trix<q.trixSignal),check('TRIX < 0',q.trix<0,q.trix),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='TRIX triple EMA 15 · signal EMA 9 · signe · EMA 50';
  }else if(strategy==='tsi'){
    buy=[check('Nouveau croisement TSI > signal EMA 7',q.previousTsi<=q.previousTsiSignal&&q.tsi>q.tsiSignal),check('TSI > 0',q.tsi>0,q.tsi),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement TSI < signal EMA 7',q.previousTsi>=q.previousTsiSignal&&q.tsi<q.tsiSignal),check('TSI < 0',q.tsi<0,q.tsi),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='TSI EMA 25/13 · signal EMA 7 · signe · EMA 50';
  }else if(strategy==='dema-reclaim'){
    buy=[check('Clôture précédente ≤ DEMA 21 précédente',p.close<=q.previousDema,q.previousDema),check('Clôture repasse au-dessus de DEMA 21 ascendante',x.close>q.dema&&q.dema>q.previousDema,q.dema),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Clôture précédente ≥ DEMA 21 précédente',p.close>=q.previousDema,q.previousDema),check('Clôture repasse sous DEMA 21 descendante',x.close<q.dema&&q.dema<q.previousDema,q.dema),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='DEMA 21 · réintégration nouvelle · pente · EMA 50';
  }else if(strategy==='chandelier'){
    buy=[check('Clôture franchit la sortie short Chandelier terminée',p.close<=q.previousChandelierShort&&x.close>q.previousChandelierShort,q.previousChandelierShort),check('Clôture > sortie long Chandelier courante',x.close>q.chandelierLong,q.chandelierLong),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Clôture franchit la sortie long Chandelier terminée',p.close>=q.previousChandelierLong&&x.close<q.previousChandelierLong,q.previousChandelierLong),check('Clôture < sortie short Chandelier courante',x.close<q.chandelierShort,q.chandelierShort),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=q.previousChandelierShort;triggerSell=q.previousChandelierLong;triggerSummary='Chandelier 22 ± 3 ATR Wilder 22 · franchissement de la référence terminée';
  }else if(strategy==='vortex'){
    buy=[check('Nouveau croisement VI+ > VI−',q.previousVortexPlus<=q.previousVortexMinus&&q.vortexPlus>q.vortexMinus),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement VI− > VI+',q.previousVortexMinus<=q.previousVortexPlus&&q.vortexMinus>q.vortexPlus),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='Vortex 14 · nouveau croisement VI+/VI− · EMA 50';
  }else if(strategy==='kama-reclaim'){
    buy=[check('Clôture précédente ≤ KAMA précédente',p.close<=q.previousKama,q.previousKama),check('Clôture repasse au-dessus de KAMA ascendante',x.close>q.kama&&q.kama>q.previousKama,q.kama),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Clôture précédente ≥ KAMA précédente',p.close>=q.previousKama,q.previousKama),check('Clôture repasse sous KAMA descendante',x.close<q.kama&&q.kama<q.previousKama,q.kama),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='KAMA 10/2/30 · nouvelle réintégration · pente · EMA 50';
  }else if(strategy==='ppo'){
    buy=[check('Nouveau croisement PPO > signal EMA 9',q.previousPpo<=q.previousPpoSignal&&q.ppo>q.ppoSignal),check('PPO > 0',q.ppo>0,q.ppo),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Nouveau croisement PPO < signal EMA 9',q.previousPpo>=q.previousPpoSignal&&q.ppo<q.ppoSignal),check('PPO < 0',q.ppo<0,q.ppo),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='PPO EMA 12/26 · signal EMA 9 · signe · EMA 50';
  }else if(strategy==='ultimate-recovery'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('Ultimate précédent ≤ 30',q.previousUltimate<=30,q.previousUltimate),check('Ultimate revient entre 30 et 70',q.ultimate>30&&q.ultimate<70,q.ultimate),check('Bougie et clôture haussières',x.close>x.open&&x.close>p.close),regime];
    sell=[check('Ultimate précédent ≥ 70',q.previousUltimate>=70,q.previousUltimate),check('Ultimate revient entre 30 et 70',q.ultimate>30&&q.ultimate<70,q.ultimate),check('Bougie et clôture baissières',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=triggerSell=null;triggerSummary='Ultimate 7/14/28 · poids 4/2/1 · sortie 30/70 · prix confirmé';
  }else if(strategy==='smi'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('SMI précédent ≤ −40',q.previousSmi<=-40,q.previousSmi),check('Nouveau croisement SMI > signal EMA 3',q.previousSmi<=q.previousSmiSignal&&q.smi>q.smiSignal),check('SMI < 40',q.smi<40,q.smi),check('Bougie et clôture haussières',x.close>x.open&&x.close>p.close),regime];
    sell=[check('SMI précédent ≥ 40',q.previousSmi>=40,q.previousSmi),check('Nouveau croisement SMI < signal EMA 3',q.previousSmi>=q.previousSmiSignal&&q.smi<q.smiSignal),check('SMI > −40',q.smi>-40,q.smi),check('Bougie et clôture baissières',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=triggerSell=null;triggerSummary='SMI 5/3/3 · nouveau croisement signal 3 depuis ±40 · prix confirmé';
  }else if(strategy==='stoch-rsi'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('%K RSI précédent ≤ 20',q.previousStochRsiK<=20,q.previousStochRsiK),check('%K RSI revient entre 20 et 80',q.stochRsiK>20&&q.stochRsiK<80,q.stochRsiK),check('%K RSI > %D RSI',q.stochRsiK>q.stochRsiD,q.stochRsiD),check('Bougie et clôture haussières',x.close>x.open&&x.close>p.close),regime];
    sell=[check('%K RSI précédent ≥ 80',q.previousStochRsiK>=80,q.previousStochRsiK),check('%K RSI revient entre 20 et 80',q.stochRsiK>20&&q.stochRsiK<80,q.stochRsiK),check('%K RSI < %D RSI',q.stochRsiK<q.stochRsiD,q.stochRsiD),check('Bougie et clôture baissières',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=triggerSell=null;triggerSummary='Stoch RSI Wilder 14/14 · %K 3 / %D 3 · sortie 20/80 · prix confirmé';
  }else if(strategy==='elder-ray'){
    buy=[check('EMA 13 ascendante',q.elderEma>q.previousElderEma,q.elderEma),check('Bears Power négatif et en hausse',q.bearsPower<0&&q.bearsPower>q.previousBearsPower,q.bearsPower),check('Clôture > EMA 13',x.close>q.elderEma,q.elderEma),check('Bougie haussière',x.close>x.open)];
    sell=[check('EMA 13 descendante',q.elderEma<q.previousElderEma,q.elderEma),check('Bulls Power positif et en baisse',q.bullsPower>0&&q.bullsPower<q.previousBullsPower,q.bullsPower),check('Clôture < EMA 13',x.close<q.elderEma,q.elderEma),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='Elder Ray EMA 13 · puissance opposée en retrait · prix confirmé';
  }else if(strategy==='demarker'){
    const regime=check('Direction modérée < 1,2 ATR',trend<1.2,trend);
    buy=[check('DeMarker précédent ≤ 0,3',q.previousDemarker<=.3,q.previousDemarker),check('DeMarker revient entre 0,3 et 0,7',q.demarker>.3&&q.demarker<.7,q.demarker),check('Bougie et clôture haussières',x.close>x.open&&x.close>p.close),regime];
    sell=[check('DeMarker précédent ≥ 0,7',q.previousDemarker>=.7,q.previousDemarker),check('DeMarker revient entre 0,3 et 0,7',q.demarker>.3&&q.demarker<.7,q.demarker),check('Bougie et clôture baissières',x.close<x.open&&x.close<p.close),regime];
    triggerBuy=triggerSell=null;triggerSummary='DeMarker 14 · sortie 0,3/0,7 · high/low réels · prix confirmé';
  }else if(strategy==='awesome'){
    buy=[check('Awesome franchit zéro à la hausse',q.previousAwesome<=0&&q.awesome>0,q.awesome),check('Clôture > EMA 50',x.close>e50,e50),check('Bougie haussière',x.close>x.open)];
    sell=[check('Awesome franchit zéro à la baisse',q.previousAwesome>=0&&q.awesome<0,q.awesome),check('Clôture < EMA 50',x.close<e50,e50),check('Bougie baissière',x.close<x.open)];
    triggerBuy=triggerSell=null;triggerSummary='Awesome SMA 5/34 du médian HL2 · nouveau zéro · EMA 50';
  }
  const count=checks=>checks.filter(c=>c.passed).length,buyPassed=count(buy),sellPassed=count(sell),side=buyPassed===buy.length?'BUY':sellPassed===sell.length?'SELL':'HOLD';
  const directionSide=side==='HOLD'?(buyPassed/buy.length>=sellPassed/sell.length?'BUY':'SELL'):side,checks=directionSide==='BUY'?buy:sell,passed=count(checks),score=Math.round(passed/checks.length*100);
  const reason=side==='HOLD'?'Attendre : '+checks.filter(c=>!c.passed).map(c=>c.label).join(' · '):definition.name+' · '+side+' · tous les critères confirmés';
  const direction=directionSide==='SELL'?-1:1,rr=strategy==='donchian55'?2:['reversion','rsi-recovery','stochastic','keltner-reentry','cci-recovery','williams-recovery','fisher-recovery','ultimate-recovery','smi','stoch-rsi','demarker'].includes(strategy)?1.3:1.8;
  let stop=x.close-direction*atr*(strategy==='donchian55'?2:1.4),riskModel='atr';
  if(['two-bar-pullback','breakout-retest'].includes(strategy)){stop=(direction===1?q.recentLow:q.recentHigh)-direction*atr*.1;riskModel='structure';}
  else if(['nr7-breakout','engulfing-reclaim','fractal-breakout','failed-breakout'].includes(strategy)){stop=(direction===1?Math.min(x.low,p.low):Math.max(x.high,p.high))-direction*atr*.1;riskModel='structure';}
  else if(strategy==='supertrend'&&q.supertrendDirection===direction){stop=q.supertrend-direction*atr*.05;riskModel='structure';}
  else if(['stochastic','keltner-reentry'].includes(strategy)){stop=(direction===1?q.recentLow:q.recentHigh)-direction*atr*.1;riskModel='structure';}
  else if(strategy==='inside-bar'){stop=(direction===1?q.mother.low:q.mother.high)-direction*atr*.1;riskModel='structure';}
  else if(strategy==='liquidity-sweep'){stop=(direction===1?x.low:x.high)-direction*atr*.1;riskModel='structure';}
  else if(strategy==='continuation'){stop=(direction===1?Math.min(e21,q.recentLow):Math.max(e21,q.recentHigh))-direction*atr*.1;riskModel='structure';}
  else if(strategy==='ichimoku'&&Number.isFinite(q.cloudBottom)&&Number.isFinite(q.cloudTop)){stop=(direction===1?Math.min(q.kijun,q.cloudBottom):Math.max(q.kijun,q.cloudTop))-direction*atr*.1;riskModel='structure';}
  else if(strategy==='cci-recovery'){stop=(direction===1?q.recentLow:q.recentHigh)-direction*atr*.1;riskModel='structure';}
  else if(['williams-recovery','fisher-recovery','dema-reclaim'].includes(strategy)){stop=(direction===1?q.recentLow:q.recentHigh)-direction*atr*.1;riskModel='structure';}
  else if(['kama-reclaim','ultimate-recovery','smi','stoch-rsi','elder-ray','demarker'].includes(strategy)){stop=(direction===1?q.recentLow:q.recentHigh)-direction*atr*.1;riskModel='structure';}
  else if(strategy==='parabolic-sar'&&q.sarDirection===direction){stop=q.sar-direction*atr*.05;riskModel='structure';}
  else if(strategy==='chandelier'){stop=(direction===1?q.chandelierLong:q.chandelierShort)-direction*atr*.05;riskModel='structure';}
  if(stop<=0||direction*(x.close-stop)<=0){stop=x.close-direction*atr*1.4;riskModel='atr';}
  const distance=Math.abs(x.close-stop),target=x.close+direction*distance*rr,invalidation={price:stop,condition:direction===1?'Passage sous le stop de référence':'Passage au-dessus du stop de référence',basis:riskModel};
  return {strategy,strategyName:definition.name,side,score,scoreLabel:'Critères réunis',checks,directionalChecks:{BUY:buy,SELL:sell},readiness:{passed,total:checks.length,percent:score,direction:directionSide},reason,regime:trend>.8?'Tendance':'Range / transition',entry:x.close,stop,target,riskDistance:distance,riskModel,invalidation,setup:{confirmed:side!=='HOLD',entry:side==='HOLD'?null:x.close,stop,target,invalidation,condition:triggerSummary},rr,atr,rsi,triggerBuy,triggerSell,triggerSummary,volumeConfirmed:q.hasVolume,time:x.time};
}
// Conditional boundaries for the NEXT candle. A level is necessary, never sufficient.
// When future high/low/volume determines the boundary, no exact entry is invented.
export function setupTriggers(bars,strategy,context=null){
  if(!strategies.some(s=>s.id===strategy))throw Error('Stratégie inconnue');
  // The next decision drops the oldest candle before seeding its indicators.
  // Updating today's 160-candle EMA would otherwise publish an incorrect crossing.
  bars=bars.filter(bar=>bar.closed!==false);
  const history=bars.slice(-(analysisWindow-1)),q=bars.length>=analysisWindow?indicators(history):context??indicators(history);
  const item=(price,mode,condition,referencePrice=price)=>({price:Number.isFinite(price)?price:null,mode,condition,referencePrice:Number.isFinite(referencePrice)?referencePrice:null,conditional:true,referenceTime:q?.last.time??null,riskBasis:'Recalcul du risque après confirmation de la prochaine clôture'});
  if(!q)return {BUY:item(null,'unavailable','Historique insuffisant'),SELL:item(null,'unavailable','Historique insuffisant')};
  const x=q.last,currentHigh=Math.max(...history.slice(-20).map(b=>b.high)),currentLow=Math.min(...history.slice(-20).map(b=>b.low));
  let buy=item(x.high,'close_above','Prochaine clôture au-dessus du sommet courant ; autres critères de la règle requis'),sell=item(x.low,'close_below','Prochaine clôture sous le creux courant ; autres critères de la règle requis');
  if(strategy==='breakout'){
    buy=item(currentHigh,'close_above','Clôture hors du canal 20 terminé, expansion et volume si disponible');sell=item(currentLow,'close_below','Clôture hors du canal 20 terminé, expansion et volume si disponible');
  }else if(strategy==='ema-cross'){
    const level=((1-2/22)*q.e21-(1-2/10)*q.e9)/(2/10-2/22);
    buy=item(level,'close_above','Nouveau croisement EMA 9/21, prix > EMA 50 et bougie haussière');sell=item(level,'close_below','Nouveau croisement EMA 9/21, prix < EMA 50 et bougie baissière');
  }else if(strategy==='macd'){
    const level=(q.macdSignal-(1-2/13)*q.e12+(1-2/27)*q.e26)/(2/13-2/27);
    buy=item(level,'close_above','MACD franchit son signal, prix > EMA 50 et clôture en hausse');sell=item(level,'close_below','MACD franchit son signal, prix < EMA 50 et clôture en baisse');
  }else if(strategy==='rsi-recovery'){
    buy=item(Math.max(x.high,x.close+Math.max(0,13*(30/70*q.loss-q.gain))),'close_above','RSI précédent ≤ 30 puis RSI entre 30 et 55 et rupture du sommet courant');
    sell=item(Math.min(x.low,x.close-Math.max(0,13*(30/70*q.gain-q.loss))),'close_below','RSI précédent ≥ 70 puis RSI entre 45 et 70 et rupture du creux courant');
  }else if(strategy==='squeeze'){
    buy=item(q.upper,'close_above','Compression préalable puis clôture hors de la bande terminée, expansion et volume');sell=item(q.lower,'close_below','Compression préalable puis clôture hors de la bande terminée, expansion et volume');
  }else if(strategy==='reversion'){
    const values=history.slice(-19).map(b=>b.close),mean=avg(values),sd=Math.sqrt(avg(values.map(v=>(v-mean)**2))),distance=Math.sqrt(16/3)*sd;
    buy=item(mean-distance,'reentry_above','Excès sous la bande précédente, prochaine clôture réintègre Bollinger 20/2, RSI < 45');sell=item(mean+distance,'reentry_below','Excès sur la bande précédente, prochaine clôture réintègre Bollinger 20/2, RSI > 55');
  }else if(strategy==='inside-bar'){
    const inside=x.high<q.previous.high&&x.low>q.previous.low&&Date.parse(x.time)-Date.parse(q.previous.time)===900000;
    buy=item(inside?q.previous.high:null,'close_above',inside?'Clôture au-dessus de la mère de la bougie intérieure courante':'Former une bougie intérieure stricte puis casser sa mère',q.previous.high);
    sell=item(inside?q.previous.low:null,'close_below',inside?'Clôture sous la mère de la bougie intérieure courante':'Former une bougie intérieure stricte puis casser sa mère',q.previous.low);
  }else if(strategy==='liquidity-sweep'){
    buy=item(currentLow,'sweep_reclaim','Prochaine mèche sous le canal terminé puis réintégration haussière avec mèche ≥ corps');sell=item(currentHigh,'sweep_reject','Prochaine mèche au-dessus du canal terminé puis réintégration baissière avec mèche ≥ corps');
  }else if(strategy==='stochastic'){
    buy=item(null,'indicator','%K 14/3 sort de la zone ≤ 20, repasse entre 20 et 65 au-dessus de %D ; prix en hausse',x.close);sell=item(null,'indicator','%K 14/3 sort de la zone ≥ 80, repasse entre 35 et 80 sous %D ; prix en baisse',x.close);
  }else if(strategy==='vwap'){
    buy=item(null,'indicator','Repli vers la VWAP 20 puis clôture haussière au-dessus ; volume prochain nécessaire',q.vwap);sell=item(null,'indicator','Repli vers la VWAP 20 puis clôture baissière sous celle-ci ; volume prochain nécessaire',q.vwap);
  }else if(strategy==='continuation'){
    buy=item(null,'indicator','EMA 9/21/50 alignées, corps haussier ≥ 0,2 ATR, clôture dans le tiers supérieur et RSI 50–78',q.e9);sell=item(null,'indicator','EMA 9/21/50 alignées, corps baissier ≥ 0,2 ATR, clôture dans le tiers inférieur et RSI 22–50',q.e9);
  }else if(strategy==='keltner-reentry'){
    buy=item(null,'indicator','Excès précédent puis réintégration haussière du canal EMA 20 − 2 ATR 14',q.keltnerLower);sell=item(null,'indicator','Excès précédent puis réintégration baissière du canal EMA 20 + 2 ATR 14',q.keltnerUpper);
  }else if(strategy==='supertrend'){
    buy=item(x.high,'close_above','Supertrend haussier confirmé, rupture du sommet courant et corps ≥ 0,25 ATR');sell=item(x.low,'close_below','Supertrend baissier confirmé, rupture du creux courant et corps ≥ 0,25 ATR');
  }else if(strategy==='adx-continuation'){
    buy=item(null,'indicator','ADX Wilder 14 ≥ 25 non décroissant, DI+ > DI−, clôture > EMA 50 et sommet courant ; high/low futurs nécessaires',x.high);sell=item(null,'indicator','ADX Wilder 14 ≥ 25 non décroissant, DI− > DI+, clôture < EMA 50 et creux courant ; high/low futurs nécessaires',x.low);
  }else if(strategy==='ichimoku'){
    buy=item(null,'indicator','Tenkan 9 > Kijun 26, clôture hors nuage visible 52/26, au-dessus de t−26 et du sommet courant ; high/low futurs nécessaires',q.cloudTop);sell=item(null,'indicator','Tenkan 9 < Kijun 26, clôture sous nuage visible 52/26, sous t−26 et creux courant ; high/low futurs nécessaires',q.cloudBottom);
  }else if(strategy==='cci-recovery'){
    buy=item(null,'indicator','CCI 20 courant ≤ −100 puis retour entre −100 et 100, bougie et clôture haussières ; prix typique futur nécessaire',x.close);sell=item(null,'indicator','CCI 20 courant ≥ 100 puis retour entre −100 et 100, bougie et clôture baissières ; prix typique futur nécessaire',x.close);
  }else if(strategy==='aroon'){
    buy=item(null,'indicator','Nouveau croisement Aroon 25 Up > Down, Up ≥ 70, Down ≤ 30 et prix > EMA 50 ; high/low futurs nécessaires',x.close);sell=item(null,'indicator','Nouveau croisement Aroon 25 Down > Up, Down ≥ 70, Up ≤ 30 et prix < EMA 50 ; high/low futurs nécessaires',x.close);
  }else if(strategy==='donchian55'){
    buy=item(Math.max(...history.slice(-55).map(bar=>bar.high)),'close_above','Prochaine clôture au-dessus du canal des 55 bougies terminées, EMA 50 et corps haussier');sell=item(Math.min(...history.slice(-55).map(bar=>bar.low)),'close_below','Prochaine clôture sous le canal des 55 bougies terminées, EMA 50 et corps baissier');
  }else if(strategy==='roc-momentum'){
    const base=history.at(-12).close;
    buy=item(Math.max(base*1.005,q.e50),'close_above','ROC 12 franchit +0,5 %, clôture > EMA 50 et corps haussier');sell=item(Math.min(base*.995,q.e50),'close_below','ROC 12 franchit −0,5 %, clôture < EMA 50 et corps baissier');
  }else if(strategy==='parabolic-sar'){
    buy=item(null,'indicator','SAR Wilder se retourne haussier, corps haussier et prix > EMA 21 ; high/low futurs requis',q.sar);sell=item(null,'indicator','SAR Wilder se retourne baissier, corps baissier et prix < EMA 21 ; high/low futurs requis',q.sar);
  }else if(strategy==='williams-recovery'){
    buy=item(null,'indicator','Williams %R 14 sort de ≤ −80 vers (−80,−20), rupture du sommet courant et direction modérée ; high/low futurs requis',x.high);sell=item(null,'indicator','Williams %R 14 sort de ≥ −20 vers (−80,−20), rupture du creux courant et direction modérée ; high/low futurs requis',x.low);
  }else if(strategy==='fisher-recovery'){
    buy=item(null,'indicator','Premier retournement ascendant Fisher 10 depuis ≤ −1, prix et bougie haussiers, direction modérée ; HL2 futur requis',x.close);sell=item(null,'indicator','Premier retournement descendant Fisher 10 depuis ≥ 1, prix et bougie baissiers, direction modérée ; HL2 futur requis',x.close);
  }else if(strategy==='trix'){
    buy=item(null,'indicator','TRIX triple EMA 15 franchit EMA 9 avec TRIX positif, prix > EMA 50 et corps haussier',x.close);sell=item(null,'indicator','TRIX triple EMA 15 franchit sous EMA 9 avec TRIX négatif, prix < EMA 50 et corps baissier',x.close);
  }else if(strategy==='tsi'){
    buy=item(null,'indicator','TSI 25/13 franchit EMA 7 avec TSI positif, prix > EMA 50 et corps haussier',x.close);sell=item(null,'indicator','TSI 25/13 franchit sous EMA 7 avec TSI négatif, prix < EMA 50 et corps baissier',x.close);
  }else if(strategy==='dema-reclaim'){
    buy=item(null,'indicator','Nouvelle clôture au-dessus de DEMA 21 ascendante, prix > EMA 50 et corps haussier',q.dema);sell=item(null,'indicator','Nouvelle clôture sous DEMA 21 descendante, prix < EMA 50 et corps baissier',q.dema);
  }else if(strategy==='chandelier'){
    buy=item(null,'indicator','Clôture franchit la sortie short Chandelier terminée, prix > sortie long courante et EMA 50 ; ATR/high/low futurs requis',q.chandelierShort);sell=item(null,'indicator','Clôture franchit la sortie long Chandelier terminée, prix < sortie short courante et EMA 50 ; ATR/high/low futurs requis',q.chandelierLong);
  }else if(strategy==='vortex'){
    buy=item(null,'indicator','Nouveau croisement VI+ > VI− 14, prix > EMA 50 et corps haussier ; high/low futurs requis',x.close);sell=item(null,'indicator','Nouveau croisement VI− > VI+ 14, prix < EMA 50 et corps baissier ; high/low futurs requis',x.close);
  }else if(strategy==='kama-reclaim'){
    buy=item(null,'indicator','Nouvelle réintégration au-dessus de KAMA 10/2/30 ascendante, EMA 50 et bougie haussière ; constante adaptative future requise',q.kama);sell=item(null,'indicator','Nouvelle réintégration sous KAMA 10/2/30 descendante, EMA 50 et bougie baissière ; constante adaptative future requise',q.kama);
  }else if(strategy==='ppo'){
    buy=item(null,'indicator','PPO 12/26 franchit EMA 9 avec signe positif, prix > EMA 50 et corps haussier',x.close);sell=item(null,'indicator','PPO 12/26 franchit sous EMA 9 avec signe négatif, prix < EMA 50 et corps baissier',x.close);
  }else if(strategy==='ultimate-recovery'){
    buy=item(null,'indicator','Ultimate 7/14/28 sort de ≤ 30 vers (30,70), prix haussier et direction modérée ; high/low futurs requis',x.close);sell=item(null,'indicator','Ultimate 7/14/28 sort de ≥ 70 vers (30,70), prix baissier et direction modérée ; high/low futurs requis',x.close);
  }else if(strategy==='smi'){
    buy=item(null,'indicator','SMI 5/3/3 croise son signal EMA 3 depuis ≤ −40, prix haussier et direction modérée ; high/low futurs requis',x.close);sell=item(null,'indicator','SMI 5/3/3 croise sous son signal EMA 3 depuis ≥ 40, prix baissier et direction modérée ; high/low futurs requis',x.close);
  }else if(strategy==='stoch-rsi'){
    buy=item(null,'indicator','Stoch RSI Wilder 14/14 %K3 sort de ≤ 20 vers (20,80) au-dessus de %D3, prix haussier et direction modérée',x.close);sell=item(null,'indicator','Stoch RSI Wilder 14/14 %K3 sort de ≥ 80 vers (20,80) sous %D3, prix baissier et direction modérée',x.close);
  }else if(strategy==='elder-ray'){
    buy=item(null,'indicator','EMA 13 ascendante, Bears Power négatif qui remonte, clôture > EMA 13 et corps haussier ; low futur requis',q.elderEma);sell=item(null,'indicator','EMA 13 descendante, Bulls Power positif qui baisse, clôture < EMA 13 et corps baissier ; high futur requis',q.elderEma);
  }else if(strategy==='demarker'){
    buy=item(null,'indicator','DeMarker 14 sort de ≤ 0,3 vers (0,3;0,7), prix haussier et direction modérée ; high/low futurs requis',x.close);sell=item(null,'indicator','DeMarker 14 sort de ≥ 0,7 vers (0,3;0,7), prix baissier et direction modérée ; high/low futurs requis',x.close);
  }else if(strategy==='awesome'){
    buy=item(null,'indicator','Awesome HL2 SMA5/34 franchit zéro, prix > EMA 50 et corps haussier ; high/low futurs requis',x.close);sell=item(null,'indicator','Awesome HL2 SMA5/34 franchit sous zéro, prix < EMA 50 et corps baissier ; high/low futurs requis',x.close);
  }
  if(strategy==='nr7-breakout'){buy=item(x.high,'breakout','Prochaine clôture au-dessus du sommet NR7 ; corps et tendance EMA requis',x.close);sell=item(x.low,'breakout','Prochaine clôture sous le creux NR7 ; corps et tendance EMA requis',x.close);}
  else if(strategy==='engulfing-reclaim'){buy=item(null,'pattern','Prochain corps haussier engloutit le corps baissier courant et réintègre EMA 21 ; OHLC futurs requis',x.close);sell=item(null,'pattern','Prochain corps baissier engloutit le corps haussier courant et réintègre EMA 21 ; OHLC futurs requis',x.close);}
  if(strategy==='fractal-breakout'){buy=item(null,'pattern','Pivot strict confirmé par deux bougies à droite puis première clôture au-dessus ; future bougie de confirmation requise',x.close);sell=item(null,'pattern','Pivot strict confirmé par deux bougies à droite puis première clôture sous le pivot ; future bougie de confirmation requise',x.close);}
  else if(strategy==='failed-breakout'){buy=item(null,'pattern','Après clôture sous le canal 20, réintégration haussière ; recalcul du canal et OHLC futurs requis',x.close);sell=item(null,'pattern','Après clôture au-dessus du canal 20, réintégration baissière ; recalcul du canal et OHLC futurs requis',x.close);}
  if(strategy==='breakout-retest'){buy=item(x.high,'close_above','Prochaine clôture au-dessus du retest maintenu après cassure du canal 20 ; EMA 21/50 et corps requis',x.close);sell=item(x.low,'close_below','Prochaine clôture sous le retest maintenu après cassure du canal 20 ; EMA 21/50 et corps requis',x.close);}
  if(strategy==='two-bar-pullback'){buy=item(Math.max(x.high,q.previous.high),'close_above','Prochaine clôture au-dessus des deux bougies baissières de repli, EMA 21/50 et corps requis',x.close);sell=item(Math.min(x.low,q.previous.low),'close_below','Prochaine clôture sous les deux bougies haussières de repli, EMA 21/50 et corps requis',x.close);}
  let buyPrerequisites=[],sellPrerequisites=[];
  const prerequisite=(label,met)=>({label,met:Boolean(met)});
  if(strategy==='breakout-retest'){buyPrerequisites=[prerequisite('Cassure précédente au-dessus du canal 20',Number.isFinite(q.failedBreakHigh)&&q.previous.close>q.failedBreakHigh),prerequisite('Retest courant tenu au-dessus du niveau',Number.isFinite(q.failedBreakHigh)&&x.low<=q.failedBreakHigh&&x.close>q.failedBreakHigh&&x.close<q.previous.close)];sellPrerequisites=[prerequisite('Cassure précédente sous le canal 20',Number.isFinite(q.failedBreakLow)&&q.previous.close<q.failedBreakLow),prerequisite('Retest courant tenu sous le niveau',Number.isFinite(q.failedBreakLow)&&x.high>=q.failedBreakLow&&x.close<q.failedBreakLow&&x.close>q.previous.close)];}
  else if(strategy==='two-bar-pullback'){buyPrerequisites=[prerequisite('Deux corps courants baissiers de repli',x.close<x.open&&q.previous.close<q.previous.open),prerequisite('Deux replis consécutifs',q.twoBarContiguous)];sellPrerequisites=[prerequisite('Deux corps courants haussiers de repli',x.close>x.open&&q.previous.close>q.previous.open),prerequisite('Deux replis consécutifs',q.twoBarContiguous)];}
  else if(strategy==='failed-breakout'){buyPrerequisites=[prerequisite('Clôture courante sous le canal 20 précédent',x.close<q.low)];sellPrerequisites=[prerequisite('Clôture courante au-dessus du canal 20 précédent',x.close>q.high)];}
  else if(strategy==='nr7-breakout'){buyPrerequisites=sellPrerequisites=[prerequisite('Bougie courante strictement NR7 sur 7 bougies consécutives',q.currentNr7)];}
  else if(strategy==='engulfing-reclaim'){buyPrerequisites=[prerequisite('Corps courant baissier avec repli sous EMA 21',x.close<x.open&&x.low<=q.e21),prerequisite('EMA 21 > EMA 50',q.e21>q.e50)];sellPrerequisites=[prerequisite('Corps courant haussier avec repli au-dessus EMA 21',x.close>x.open&&x.high>=q.e21),prerequisite('EMA 21 < EMA 50',q.e21<q.e50)];}
  else if(strategy==='ema-cross'){buyPrerequisites=[prerequisite('EMA 9 actuellement ≤ EMA 21',q.e9<=q.e21)];sellPrerequisites=[prerequisite('EMA 9 actuellement ≥ EMA 21',q.e9>=q.e21)];}
  else if(strategy==='macd'){buyPrerequisites=[prerequisite('MACD actuellement ≤ signal',q.macd<=q.macdSignal)];sellPrerequisites=[prerequisite('MACD actuellement ≥ signal',q.macd>=q.macdSignal)];}
  else if(strategy==='rsi-recovery'){buyPrerequisites=[prerequisite('RSI actuellement ≤ 30',q.rsi<=30)];sellPrerequisites=[prerequisite('RSI actuellement ≥ 70',q.rsi>=70)];}
  else if(strategy==='stochastic'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('%K actuellement ≤ 20',q.stochastic<=20),regime];sellPrerequisites=[prerequisite('%K actuellement ≥ 80',q.stochastic>=80),regime];}
  else if(strategy==='reversion'){const regime=prerequisite('Faible direction actuelle < 0,65 ATR',q.trend<.65);buyPrerequisites=[prerequisite('Clôture courante sous bande basse',x.close<q.lower),regime];sellPrerequisites=[prerequisite('Clôture courante au-dessus bande haute',x.close>q.upper),regime];}
  else if(strategy==='keltner-reentry'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('Clôture courante sous Keltner',x.close<q.keltnerLower),regime];sellPrerequisites=[prerequisite('Clôture courante au-dessus Keltner',x.close>q.keltnerUpper),regime];}
  else if(strategy==='inside-bar'){buyPrerequisites=sellPrerequisites=[prerequisite('Bougie courante intérieure stricte',x.high<q.previous.high&&x.low>q.previous.low),prerequisite('Mère et bougie intérieure consécutives',Date.parse(x.time)-Date.parse(q.previous.time)===900000)];}
  else if(strategy==='pullback'){buyPrerequisites=[prerequisite('EMA actuellement 9 > 21 > 50',q.e9>q.e21&&q.e21>q.e50),prerequisite('RSI courant entre 45 et 72',q.rsi>45&&q.rsi<72),prerequisite('Repli courant vers EMA 9',x.low<=q.e9)];sellPrerequisites=[prerequisite('EMA actuellement 9 < 21 < 50',q.e9<q.e21&&q.e21<q.e50),prerequisite('RSI courant entre 28 et 55',q.rsi>28&&q.rsi<55),prerequisite('Repli courant vers EMA 9',x.high>=q.e9)];}
  else if(strategy==='supertrend'){buyPrerequisites=[prerequisite('Supertrend actuellement haussier',q.supertrendDirection===1)];sellPrerequisites=[prerequisite('Supertrend actuellement baissier',q.supertrendDirection===-1)];}
  else if(strategy==='squeeze'){
    // This percentile uses the 40 completed band windows that will precede
    // the next candle. Its value is independent of that candle's unknown close.
    const closes=history.map(bar=>bar.close),widths=Array.from({length:40},(_,i)=>band(closes.slice(closes.length-59+i,closes.length-39+i)).width).sort((a,b)=>a-b),threshold=widths[Math.floor((widths.length-1)*.2)];
    buyPrerequisites=sellPrerequisites=[prerequisite('Compression courante dans le quintile bas de 40 observations',q.width>0&&q.width<=threshold)];
  }
  else if(strategy==='vwap'){const volume=prerequisite('Volume fourni sur les 21 bougies terminées',q.hasVolume&&q.vwap!==null);buyPrerequisites=[volume,prerequisite('Repli courant vers VWAP 20',q.vwap!==null&&x.low<=q.vwap)];sellPrerequisites=[volume,prerequisite('Repli courant vers VWAP 20',q.vwap!==null&&x.high>=q.vwap)];}
  else if(strategy==='liquidity-sweep'){buyPrerequisites=sellPrerequisites=[prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2)];}
  else if(strategy==='continuation'){buyPrerequisites=[prerequisite('EMA actuellement 9 > 21 > 50 et EMA 21 monte',q.e9>q.e21&&q.e21>q.e50&&q.e21>q.previousE21),prerequisite('RSI courant entre 50 et 78',q.rsi>50&&q.rsi<78)];sellPrerequisites=[prerequisite('EMA actuellement 9 < 21 < 50 et EMA 21 baisse',q.e9<q.e21&&q.e21<q.e50&&q.e21<q.previousE21),prerequisite('RSI courant entre 22 et 50',q.rsi>22&&q.rsi<50)];}
  else if(strategy==='adx-continuation'){const strength=prerequisite('ADX courant ≥ 25',q.adx>=25);buyPrerequisites=[strength,prerequisite('DI+ actuellement > DI−',q.diPlus>q.diMinus),prerequisite('Clôture courante > EMA 50',x.close>q.e50)];sellPrerequisites=[strength,prerequisite('DI− actuellement > DI+',q.diMinus>q.diPlus),prerequisite('Clôture courante < EMA 50',x.close<q.e50)];}
  else if(strategy==='ichimoku'){const known=prerequisite('Nuage visible 52/26 disponible',Number.isFinite(q.cloudA)&&Number.isFinite(q.cloudB));buyPrerequisites=[known,prerequisite('Tenkan actuellement > Kijun',q.tenkan>q.kijun),prerequisite('Clôture courante au-dessus du nuage',Number.isFinite(q.cloudTop)&&x.close>q.cloudTop)];sellPrerequisites=[known,prerequisite('Tenkan actuellement < Kijun',q.tenkan<q.kijun),prerequisite('Clôture courante sous le nuage',Number.isFinite(q.cloudBottom)&&x.close<q.cloudBottom)];}
  else if(strategy==='cci-recovery'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('CCI courant ≤ −100',q.cci<=-100),regime];sellPrerequisites=[prerequisite('CCI courant ≥ 100',q.cci>=100),regime];}
  else if(strategy==='aroon'){buyPrerequisites=[prerequisite('Aroon Up actuellement ≤ Down',q.aroonUp<=q.aroonDown)];sellPrerequisites=[prerequisite('Aroon Down actuellement ≤ Up',q.aroonDown<=q.aroonUp)];}
  else if(strategy==='donchian55'){buyPrerequisites=[prerequisite('Clôture courante ≥ EMA 50',x.close>=q.e50)];sellPrerequisites=[prerequisite('Clôture courante ≤ EMA 50',x.close<=q.e50)];}
  else if(strategy==='roc-momentum'){buyPrerequisites=[prerequisite('ROC courant ≤ +0,5 %',q.roc<=.5)];sellPrerequisites=[prerequisite('ROC courant ≥ −0,5 %',q.roc>=-.5)];}
  else if(strategy==='parabolic-sar'){buyPrerequisites=[prerequisite('SAR actuellement baissier',q.sarDirection===-1)];sellPrerequisites=[prerequisite('SAR actuellement haussier',q.sarDirection===1)];}
  else if(strategy==='williams-recovery'){buyPrerequisites=[prerequisite('%R courant ≤ −80',q.williamsR<=-80)];sellPrerequisites=[prerequisite('%R courant ≥ −20',q.williamsR>=-20)];}
  else if(strategy==='fisher-recovery'){buyPrerequisites=[prerequisite('Fisher courant ≤ −1 et non ascendant',q.fisher<=-1&&q.fisher<=q.fisherTrigger)];sellPrerequisites=[prerequisite('Fisher courant ≥ 1 et non descendant',q.fisher>=1&&q.fisher>=q.fisherTrigger)];}
  else if(strategy==='trix'){buyPrerequisites=[prerequisite('TRIX courant ≤ signal EMA 9',q.trix<=q.trixSignal)];sellPrerequisites=[prerequisite('TRIX courant ≥ signal EMA 9',q.trix>=q.trixSignal)];}
  else if(strategy==='tsi'){buyPrerequisites=[prerequisite('TSI courant ≤ signal EMA 7',q.tsi<=q.tsiSignal)];sellPrerequisites=[prerequisite('TSI courant ≥ signal EMA 7',q.tsi>=q.tsiSignal)];}
  else if(strategy==='dema-reclaim'){buyPrerequisites=[prerequisite('Clôture courante ≤ DEMA 21',x.close<=q.dema)];sellPrerequisites=[prerequisite('Clôture courante ≥ DEMA 21',x.close>=q.dema)];}
  else if(strategy==='chandelier'){buyPrerequisites=[prerequisite('Clôture courante ≤ sortie short Chandelier',x.close<=q.chandelierShort)];sellPrerequisites=[prerequisite('Clôture courante ≥ sortie long Chandelier',x.close>=q.chandelierLong)];}
  else if(strategy==='vortex'){buyPrerequisites=[prerequisite('VI+ actuellement ≤ VI−',q.vortexPlus<=q.vortexMinus)];sellPrerequisites=[prerequisite('VI− actuellement ≤ VI+',q.vortexMinus<=q.vortexPlus)];}
  else if(strategy==='kama-reclaim'){buyPrerequisites=[prerequisite('Clôture courante ≤ KAMA',x.close<=q.kama)];sellPrerequisites=[prerequisite('Clôture courante ≥ KAMA',x.close>=q.kama)];}
  else if(strategy==='ppo'){buyPrerequisites=[prerequisite('PPO courant ≤ signal EMA 9',q.ppo<=q.ppoSignal)];sellPrerequisites=[prerequisite('PPO courant ≥ signal EMA 9',q.ppo>=q.ppoSignal)];}
  else if(strategy==='ultimate-recovery'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('Ultimate courant ≤ 30',q.ultimate<=30),regime];sellPrerequisites=[prerequisite('Ultimate courant ≥ 70',q.ultimate>=70),regime];}
  else if(strategy==='smi'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('SMI courant ≤ −40 et ≤ signal',q.smi<=-40&&q.smi<=q.smiSignal),regime];sellPrerequisites=[prerequisite('SMI courant ≥ 40 et ≥ signal',q.smi>=40&&q.smi>=q.smiSignal),regime];}
  else if(strategy==='stoch-rsi'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('%K RSI courant ≤ 20',q.stochRsiK<=20),regime];sellPrerequisites=[prerequisite('%K RSI courant ≥ 80',q.stochRsiK>=80),regime];}
  else if(strategy==='elder-ray'){buyPrerequisites=[prerequisite('Bears Power courant négatif',q.bearsPower<0)];sellPrerequisites=[prerequisite('Bulls Power courant positif',q.bullsPower>0)];}
  else if(strategy==='demarker'){const regime=prerequisite('Direction actuelle modérée < 1,2 ATR',q.trend<1.2);buyPrerequisites=[prerequisite('DeMarker courant ≤ 0,3',q.demarker<=.3),regime];sellPrerequisites=[prerequisite('DeMarker courant ≥ 0,7',q.demarker>=.7),regime];}
  else if(strategy==='awesome'){buyPrerequisites=[prerequisite('Awesome courant ≤ 0',q.awesome<=0)];sellPrerequisites=[prerequisite('Awesome courant ≥ 0',q.awesome>=0)];}
  return {BUY:{...buy,prerequisites:buyPrerequisites},SELL:{...sell,prerequisites:sellPrerequisites}};
}
export function exitPrice(p,b){
  const long=p.side==='BUY';
  if(long?b.open<=p.stop:b.open>=p.stop)return {price:b.open,reason:'Gap stop'};
  if(long?b.low<=p.stop:b.high>=p.stop)return {price:p.stop,reason:'Stop'};
  if(long?b.open>=p.target:b.open<=p.target)return {price:p.target,reason:'Objectif'};
  if(long?b.high>=p.target:b.low<=p.target)return {price:p.target,reason:'Objectif'};
  return null;
}
export function metrics(trades){
  const n=trades.length,w=trades.filter(t=>t.r>0).length,positive=trades.filter(t=>t.r>0).reduce((s,t)=>s+t.r,0),negative=-trades.filter(t=>t.r<0).reduce((s,t)=>s+t.r,0);let equity=0,peak=0,dd=0;
  for(const t of trades){equity+=t.r;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  const phat=n?w/n:0,z=1.96,den=1+z*z/Math.max(n,1),center=(phat+z*z/(2*Math.max(n,1)))/den,half=z*Math.sqrt(phat*(1-phat)/Math.max(n,1)+z*z/(4*Math.max(n,1)**2))/den;
  return {n,wins:w,winRate:n?100*w/n:null,winInterval:n?[Math.max(0,center-half)*100,Math.min(1,center+half)*100]:null,expectancy:n?equity/n:null,totalR:equity,profitFactor:negative?positive/negative:null,maxDrawdownR:dd};
}
export function backtest(bars,strategy,{start=60,end=bars.length,feeBps=2,feePerUnit=0,slippageBps=2,maxBars=16}={}){
  bars=bars.filter(bar=>bar.closed!==false);end=Math.min(end,bars.length);
  const trades=[];let p=null,censored=0;
  for(let i=Math.max(60,start);i<end;i++){
    const b=bars[i];
    if(Date.parse(b.time)-Date.parse(bars[i-1].time)!==900000){if(p){censored++;p=null;}continue;}
    if(p){let out=Date.parse(b.time)-Date.parse(p.time)>=maxBars*900000?{price:b.open,reason:'Expiration '+maxBars+' × 15 min'}:exitPrice(p,b);if(!out&&i===end-1)out={price:b.close,reason:'Fin de période'};if(out){const dir=p.side==='BUY'?1:-1,price=out.price*(1-dir*slippageBps/10000),net=dir*(price-p.entry)-roundTripFee({feeBps,feePerUnit},p.entry,price);trades.push({...p,exit:price,exitTime:b.time,reason:out.reason,r:net/p.riskUnit});p=null;}continue;}
    if(i===end-1||Date.parse(b.time)-Date.parse(bars[i-1].time)>30*60000)continue;
    const s=signal(bars.slice(Math.max(0,i-analysisWindow),i),strategy);if(s.side==='HOLD')continue;
    const plan=executionPlan(s,{price:b.open},{feeBps,feePerUnit,slippageBps});if(!plan.valid)continue;
    const {entry,stop,target}=plan,dir=s.side==='BUY'?1:-1,distance=plan.riskDistance;
    p={side:s.side,entry,stop,target,distance,riskUnit:plan.netRisk,index:i,time:b.time,signalTime:s.time,strategy};
    const out=exitPrice(p,b);if(out){const price=out.price*(1-dir*slippageBps/10000);trades.push({...p,exit:price,exitTime:b.time,reason:out.reason,r:(dir*(price-entry)-roundTripFee({feeBps,feePerUnit},entry,price))/p.riskUnit});p=null;}
  }
  return {...metrics(trades),trades,censored};
}
export function laboratory(dataset){
  const b=dataset.bars,n=b.length,a=Math.floor(n*.5),v=Math.floor(n*.75),cost=costForSymbol(dataset.symbol);
  const results=strategies.map(s=>({...s,train:backtest(b,s.id,{...cost,end:a}),validation:backtest(b,s.id,{...cost,start:a,end:v}),test:backtest(b,s.id,{...cost,start:v}),cost}));
  const eligible=results.filter(r=>r.validation.n>=20&&r.validation.expectancy>0).sort((x,y)=>y.validation.expectancy-x.validation.expectancy);
  const selected=eligible[0]?.id??null;
  return {symbol:dataset.symbol,source:dataset.source,from:b[0]?.time,to:b.at(-1)?.time,bars:n,split:[.5,.25,.25],selected,results};
}
export function sizePosition({capital,riskPercent,entry,stop,feeBps=10,slippageBps=5,unitRisk:exactUnitRisk=null}){
  if(![capital,riskPercent,entry,stop].every(Number.isFinite)||capital<=0||riskPercent<=0||riskPercent>1||entry<=0||stop<=0||entry===stop)throw Error('Paramètres de risque invalides');
  if(exactUnitRisk!==null&&(!Number.isFinite(exactUnitRisk)||exactUnitRisk<=0))throw Error('Risque unitaire invalide');
  const budget=capital*riskPercent/100,unitRisk=exactUnitRisk??(Math.abs(entry-stop)+2*entry*(feeBps+slippageBps)/10000),quantity=Math.min(budget/unitRisk,capital/entry);
  return {risk:exactUnitRisk===null?budget:quantity*unitRisk,unitRisk,quantity,notional:quantity*entry};
}
