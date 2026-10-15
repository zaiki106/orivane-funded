import {analyzeIntelligenceContext} from './intelligence-strategies.mjs';

// Independent price-only research recipes. No model promotion or order routing.
const definitions=[
 ['price-rsi2','RSI 2 · reprise dans la tendance','reversion','RSI Wilder 2 sort de 10/90, EMA 55 et bougie directionnelle confirment.'],
 ['price-heikin-turn','Heikin Ashi · retournement confirmé','price-structure','Le corps Heikin Ashi change de signe, puis le prix dépasse le sommet/creux précédent dans le sens de EMA 55.'],
 ['price-pivot-reclaim','Pivot glissant · réintégration S1/R1','session','Pivot P=(H+L+C)/3 des 96 bougies antérieures ; mèche hors de S1/R1 puis réintégration directionnelle. Fenêtre glissante de 24 h, pas une séance officielle.'],
 ['price-dual-thrust','Dual Thrust · canal quatre bougies','breakout','Range=max(HH−LC,HC−LL) des quatre bougies précédentes ; premier passage de la clôture au-delà de la clôture précédente ± 0,5 range.'],
 ['price-range-drive','Expansion · trois bougies directionnelles','volatility','Trois clôtures progressives, extrêmes progressifs et dernière amplitude ≥ 1,5 fois la moyenne des 14 amplitudes précédentes.'],
 ['price-three-bar-turn','Étoile trois bougies · sans gap','price-structure','Premier corps ≥ 0,7 ATR, corps central ≤ 0,25 ATR, clôture opposée au-delà du milieu du premier corps.'],
 ['price-rank-recovery','Rang percentile · sortie des extrêmes','reversion','Rang de clôture parmi les 50 clôtures antérieures : passage de ≤10 % à >20 %, ou de ≥90 % à <80 %, confirmé par le corps.'],
 ['price-nine-exhaustion','Neuf clôtures · épuisement confirmé','reversion','Neuf clôtures consécutives sous/au-dessus de celle de quatre bougies plus tôt, puis rupture du sommet/creux précédent avec corps opposé.'],
 ['price-mad-reentry','Canal médian · réintégration robuste','reversion','Médiane et écart absolu médian des 50 clôtures antérieures à la précédente ; retour dans le canal médiane ± 2,5 MAD après excès.'],
 ['price-bop-cross','Balance of Power · passage de zéro','trend','Moyenne sur 20 de (clôture−ouverture)/(haut−bas) ; nouveau passage de zéro et corps dans la même direction.'],
 ['price-rvi-cross','Vigueur relative · croisement','trend','RVI simplifié = somme des corps / somme des amplitudes sur 10 bougies ; nouveau croisement de sa SMA 4, signe et corps directionnel.'],
 ['price-dmi-cross','DI Wilder · nouveau croisement','trend','DI+ et DI− Wilder 14 changent d’ordre ; la clôture dépasse l’extrême précédent avec un corps directionnel.'],
 ['price-gap-fill','Gap 15 min · retour confirmé','reversion','Ouverture éloignée de ≥ 0,5 ATR précédent de la clôture précédente ; clôture repasse de l’autre côté de cette référence avec corps opposé. Gap de prix observé, pas de séance supposée.'],
 ['price-fvg-retest','Déséquilibre trois bougies · retest','price-structure','Espace strict entre les mèches de deux bougies séparées par une impulsion ; bougie suivante ne le touche pas, puis retest maintenu et clôture de reprise.'],
 ['price-hikkake','Hikkake · échec de bougie intérieure','price-structure','Bougie intérieure stricte, fausse sortie clôturée d’un côté puis clôture de l’autre côté de la bougie intérieure. Quatre bougies terminées.'],
 ['price-rsi-divergence','Divergence RSI · pivots confirmés','reversion','Deux pivots stricts à deux bougies de chaque côté dans les 60 dernières observations : nouvel extrême de prix, RSI Wilder 14 moins extrême, puis rupture précédente. Le second pivot vient d’être confirmé.'],
];
export const priceResearchStrategies=Object.freeze(definitions.map(([id,name,family,formula])=>Object.freeze({id,name,family,formula,researchOnly:true,volumeRequired:false,warmupBars:120,parameters:{stopAtr:1.5,targetR:2}})));
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const check=(label,passed,value=null)=>({label,passed:Boolean(passed),value:Number.isFinite(value)?value:null});
function rsi2(bars){let gain=0,loss=0;const result=bars.map(()=>null);for(let i=1;i<bars.length;i++){const change=bars[i].close-bars[i-1].close;if(i<=2){gain+=Math.max(0,change)/2;loss+=Math.max(0,-change)/2;}else{gain=(gain+Math.max(0,change))/2;loss=(loss+Math.max(0,-change))/2;}if(i>=2)result[i]=gain+loss===0?50:loss===0?100:100-100/(1+gain/loss);}return result;}
function heikin(bars){let previous=null;return bars.map(b=>{const close=(b.open+b.high+b.low+b.close)/4,open=previous?(previous.open+previous.close)/2:(b.open+b.close)/2;previous={open,close};return previous;});}
const rank=(bars,index)=>100*bars.slice(index-50,index).filter(b=>b.close<bars[index].close).length/50;
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
function rsi14(bars){let gain=0,loss=0;return bars.map((b,i)=>{if(!i)return null;const c=b.close-bars[i-1].close;if(i<=14){gain+=Math.max(0,c)/14;loss+=Math.max(0,-c)/14;}else{gain=(13*gain+Math.max(0,c))/14;loss=(13*loss+Math.max(0,-c))/14;}return i<14?null:gain+loss===0?50:loss===0?100:100-100/(1+gain/loss);});}
function directional(bars){let plus=0,minus=0,tr=0;return bars.map((b,i)=>{if(!i)return null;const p=bars[i-1],up=b.high-p.high,down=p.low-b.low,dmP=up>down&&up>0?up:0,dmM=down>up&&down>0?down:0,range=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));if(i<=14){plus+=dmP/14;minus+=dmM/14;tr+=range/14;}else{plus=(13*plus+dmP)/14;minus=(13*minus+dmM)/14;tr=(13*tr+range)/14;}return i<14?null:{plus:tr>0?100*plus/tr:0,minus:tr>0?100*minus/tr:0};});}
export function evaluatePriceResearch(input,{asOf=Date.now()}={}){
 const context=analyzeIntelligenceContext(input,{nowMs:asOf,requireVolume:false});
 const bars=context.bars,n=bars.length,i=n-1,x=bars.at(-1),p=bars.at(-2),a=bars.at(-3);
 const rsi=context.valid?rsi2(bars):[],ha=context.valid?heikin(bars):[];
 const longRsi=context.valid?rsi14(bars):[],di=context.valid?directional(bars):[];
 return priceResearchStrategies.map(rule=>{
  const base={...rule,side:'HOLD',entry:null,stop:null,target:null,atr:context.valid?context.atr:null,reason:context.reason??'setup-not-confirmed',directionalChecks:{BUY:[],SELL:[]},referenceTime:context.valid?x.time:null};
  if(!context.valid)return {...base,dataReady:false};
  const atr=context.atr;let buy=[],sell=[];
  if(rule.id==='price-rsi2'){
   buy=[check('RSI 2 précédent ≤ 10',rsi[i-1]<=10,rsi[i-1]),check('RSI 2 repasse > 10',rsi[i]>10,rsi[i]),check('Prix > EMA 55',x.close>context.ema55,context.ema55),check('Corps haussier',x.close>x.open)];
   sell=[check('RSI 2 précédent ≥ 90',rsi[i-1]>=90,rsi[i-1]),check('RSI 2 repasse < 90',rsi[i]<90,rsi[i]),check('Prix < EMA 55',x.close<context.ema55,context.ema55),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-heikin-turn'){
   buy=[check('Corps HA précédent baissier',ha[i-1].close<ha[i-1].open),check('Corps HA courant haussier',ha[i].close>ha[i].open),check('Clôture > sommet précédent',x.close>p.high,p.high),check('Prix > EMA 55',x.close>context.ema55,context.ema55)];
   sell=[check('Corps HA précédent haussier',ha[i-1].close>ha[i-1].open),check('Corps HA courant baissier',ha[i].close<ha[i].open),check('Clôture < creux précédent',x.close<p.low,p.low),check('Prix < EMA 55',x.close<context.ema55,context.ema55)];
  }else if(rule.id==='price-pivot-reclaim'){
   const window=bars.slice(-97,-1),high=Math.max(...window.map(b=>b.high)),low=Math.min(...window.map(b=>b.low)),pivot=(high+low+p.close)/3,s1=2*pivot-high,r1=2*pivot-low;
   buy=[check('Mèche sous S1',x.low<s1,s1),check('Clôture réintègre S1',x.close>s1,s1),check('Corps haussier',x.close>x.open)];
   sell=[check('Mèche au-dessus de R1',x.high>r1,r1),check('Clôture réintègre R1',x.close<r1,r1),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-dual-thrust'){
   const rangeAt=end=>{const w=bars.slice(end-4,end);return Math.max(Math.max(...w.map(b=>b.high))-Math.min(...w.map(b=>b.close)),Math.max(...w.map(b=>b.close))-Math.min(...w.map(b=>b.low)));};
   const range=rangeAt(i),previousRange=rangeAt(i-1),upper=p.close+.5*range,lower=p.close-.5*range;
   buy=[check('Clôture > canal supérieur',x.close>upper,upper),check('Pas de cassure supérieure précédente',p.close<=a.close+.5*previousRange),check('Range positif',range>0,range)];
   sell=[check('Clôture < canal inférieur',x.close<lower,lower),check('Pas de cassure inférieure précédente',p.close>=a.close-.5*previousRange),check('Range positif',range>0,range)];
  }else if(rule.id==='price-range-drive'){
   const threshold=1.5*mean(bars.slice(-15,-1).map(b=>b.high-b.low));
   buy=[check('Trois clôtures en hausse',a.close<p.close&&p.close<x.close),check('Trois creux en hausse',a.low<p.low&&p.low<x.low),check('Amplitude ≥ seuil',x.high-x.low>=threshold,threshold),check('Corps haussier',x.close>x.open)];
   sell=[check('Trois clôtures en baisse',a.close>p.close&&p.close>x.close),check('Trois sommets en baisse',a.high>p.high&&p.high>x.high),check('Amplitude ≥ seuil',x.high-x.low>=threshold,threshold),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-three-bar-turn'){
   const midpoint=(a.open+a.close)/2;
   buy=[check('Premier corps baissier ≥ 0,7 ATR',a.open-a.close>=.7*atr),check('Petit corps central',Math.abs(p.close-p.open)<=.25*atr),check('Corps courant haussier',x.close>x.open),check('Clôture > milieu premier corps',x.close>midpoint,midpoint)];
   sell=[check('Premier corps haussier ≥ 0,7 ATR',a.close-a.open>=.7*atr),check('Petit corps central',Math.abs(p.close-p.open)<=.25*atr),check('Corps courant baissier',x.close<x.open),check('Clôture < milieu premier corps',x.close<midpoint,midpoint)];
  }else if(rule.id==='price-rank-recovery'){
   const before=rank(bars,i-1),current=rank(bars,i);
   buy=[check('Rang précédent ≤ 10 %',before<=10,before),check('Rang courant > 20 %',current>20,current),check('Corps haussier',x.close>x.open)];
   sell=[check('Rang précédent ≥ 90 %',before>=90,before),check('Rang courant < 80 %',current<80,current),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-mad-reentry'){
   const window=bars.slice(-52,-2).map(b=>b.close),center=median(window),mad=median(window.map(v=>Math.abs(v-center))),low=center-2.5*mad,high=center+2.5*mad;
   buy=[check('Dispersion médiane positive',mad>0,mad),check('Clôture précédente sous canal',p.close<low,low),check('Clôture réintègre le canal',x.close>low&&x.close<high),check('Corps haussier',x.close>x.open)];
   sell=[check('Dispersion médiane positive',mad>0,mad),check('Clôture précédente au-dessus du canal',p.close>high,high),check('Clôture réintègre le canal',x.close<high&&x.close>low),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-bop-cross'){
   const at=end=>mean(bars.slice(end-19,end+1).map(b=>b.high>b.low?(b.close-b.open)/(b.high-b.low):0)),before=at(i-1),current=at(i);
   buy=[check('BOP précédent ≤ 0',before<=0,before),check('BOP courant > 0',current>0,current),check('Corps haussier',x.close>x.open)];
   sell=[check('BOP précédent ≥ 0',before>=0,before),check('BOP courant < 0',current<0,current),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-rvi-cross'){
   const at=end=>{const w=bars.slice(end-9,end+1),range=w.reduce((s,b)=>s+b.high-b.low,0);return range>0?w.reduce((s,b)=>s+b.close-b.open,0)/range:0;},current=at(i),before=at(i-1),signal=mean([0,1,2,3].map(k=>at(i-k))),previousSignal=mean([1,2,3,4].map(k=>at(i-k)));
   buy=[check('RVI précédent ≤ signal précédent',before<=previousSignal,before),check('RVI > signal et > 0',current>signal&&current>0,current),check('Corps haussier',x.close>x.open)];
   sell=[check('RVI précédent ≥ signal précédent',before>=previousSignal,before),check('RVI < signal et < 0',current<signal&&current<0,current),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-dmi-cross'){
   buy=[check('DI+ précédent ≤ DI−',di[i-1].plus<=di[i-1].minus),check('DI+ courant > DI−',di[i].plus>di[i].minus,di[i].plus-di[i].minus),check('Clôture > sommet précédent',x.close>p.high,p.high),check('Corps haussier',x.close>x.open)];
   sell=[check('DI− précédent ≤ DI+',di[i-1].minus<=di[i-1].plus),check('DI− courant > DI+',di[i].minus>di[i].plus,di[i].minus-di[i].plus),check('Clôture < creux précédent',x.close<p.low,p.low),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-gap-fill'){
   buy=[check('Gap baissier ≥ 0,5 ATR précédent',p.close-x.open>=.5*context.series.atr[i-1]),check('Clôture au-dessus référence',x.close>p.close,p.close),check('Corps haussier',x.close>x.open)];
   sell=[check('Gap haussier ≥ 0,5 ATR précédent',x.open-p.close>=.5*context.series.atr[i-1]),check('Clôture sous référence',x.close<p.close,p.close),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-fvg-retest'){
   const mother=bars[i-4],impulse=bars[i-3],gap=bars[i-2];
   buy=[check('Déséquilibre haussier strict',gap.low>mother.high),check('Impulsion haussière',impulse.close>impulse.open),check('Bougie précédente ne touche pas la zone',p.low>gap.low),check('Retest maintenu dans la zone',x.low<=gap.low&&x.low>mother.high),check('Reprise au-dessus de la zone',x.close>gap.low&&x.close>x.open)];
   sell=[check('Déséquilibre baissier strict',gap.high<mother.low),check('Impulsion baissière',impulse.close<impulse.open),check('Bougie précédente ne touche pas la zone',p.high<gap.high),check('Retest maintenu dans la zone',x.high>=gap.high&&x.high<mother.low),check('Reprise sous la zone',x.close<gap.high&&x.close<x.open)];
  }else if(rule.id==='price-hikkake'){
   const mother=bars[i-3],inside=bars[i-2],valid=inside.high<mother.high&&inside.low>mother.low;
   buy=[check('Bougie intérieure stricte',valid),check('Fausse sortie inférieure clôturée',p.low<inside.low&&p.close<inside.low),check('Clôture au-dessus intérieur',x.close>inside.high,inside.high),check('Corps haussier',x.close>x.open)];
   sell=[check('Bougie intérieure stricte',valid),check('Fausse sortie supérieure clôturée',p.high>inside.high&&p.close>inside.high),check('Clôture sous intérieur',x.close<inside.low,inside.low),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-rsi-divergence'){
   const pivots=(field,sign)=>{const result=[];for(let j=Math.max(16,i-60);j<=i-2;j++)if([-2,-1,1,2].every(k=>sign*bars[j][field]>sign*bars[j+k][field]))result.push(j);return result.slice(-2);};
   const lows=pivots('low',-1),highs=pivots('high',1),lo=lows.length===2?lows:null,hi=highs.length===2?highs:null;
   buy=[check('Deux creux, dernier juste confirmé',lo&&lo[1]===i-2),check('Nouveau plus bas de prix',lo&&bars[lo[1]].low<bars[lo[0]].low),check('RSI 14 remonte entre pivots',lo&&longRsi[lo[1]]>longRsi[lo[0]]),check('Clôture > sommet précédent',x.close>p.high,p.high),check('Corps haussier',x.close>x.open)];
   sell=[check('Deux sommets, dernier juste confirmé',hi&&hi[1]===i-2),check('Nouveau plus haut de prix',hi&&bars[hi[1]].high>bars[hi[0]].high),check('RSI 14 descend entre pivots',hi&&longRsi[hi[1]]<longRsi[hi[0]]),check('Clôture < creux précédent',x.close<p.low,p.low),check('Corps baissier',x.close<x.open)];
  }else if(rule.id==='price-nine-exhaustion'){
   const prior=Array.from({length:9},(_,k)=>i-9+k);
   buy=[check('Neuf clôtures sous t−4',prior.every(j=>bars[j].close<bars[j-4].close)),check('Clôture > sommet précédent',x.close>p.high,p.high),check('Corps haussier',x.close>x.open)];
   sell=[check('Neuf clôtures au-dessus de t−4',prior.every(j=>bars[j].close>bars[j-4].close)),check('Clôture < creux précédent',x.close<p.low,p.low),check('Corps baissier',x.close<x.open)];
  }
  const bullish=buy.length>0&&buy.every(c=>c.passed),bearish=sell.length>0&&sell.every(c=>c.passed);
  const active=bullish!==bearish,side=active?(bullish?'BUY':'SELL'):'HOLD',direction=side==='BUY'?1:-1;
  const entry=active?x.close:null,stop=active?entry-direction*1.5*atr:null,target=active?entry+direction*3*atr:null;
  const valid=active&&[entry,stop,target].every(v=>Number.isFinite(v)&&v>0);
  return {...base,dataReady:true,directionalChecks:{BUY:buy,SELL:sell},side:valid?side:'HOLD',entry:valid?entry:null,stop:valid?stop:null,target:valid?target:null,reason:valid?'closed-setup-confirmed':active?'invalid-risk-levels':'setup-not-confirmed'};
 });
}
