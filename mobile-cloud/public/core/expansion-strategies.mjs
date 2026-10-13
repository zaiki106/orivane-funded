// Browser ports of public indicator formulas. Pinned upstream and MIT notices:
// THIRD_PARTY_NOTICES.md. Trading conditions are original, fixed 15m adaptations.
export const expansionStrategies=[
 ['tema-reclaim','Triple EMA reclaim','TEMA 21 : 3 EMA1 − 3 EMA2 + EMA3 ; réintégration clôturée, pente et EMA 50.'],
 ['zlema-reclaim','Zero-lag EMA reclaim','EMA 21 de 2 clôture − clôture t−10 ; réintégration, pente et EMA 50.'],
 ['vhf-breakout','VHF channel breakout','VHF 28 ≥ 0,4, canal 20 strictement antérieur franchi et EMA 50 confirmée.'],
 ['stc-recovery','Schaff cycle recovery','MACD 23/50, deux stochastiques 10 lissés EMA 3 ; sortie 25/75 et EMA 50.'],
 ['dpo-recovery','Detrended cycle recovery','DPO causal 20 = clôture t−11 − SMA 20 ; passage de zéro et rupture précédente en régime modéré.'],
 ['mass-reversal','Mass bulge reversal','Mass Index EMA 9/9, somme 25 ; bulge > 27 terminé, retour sous 26,5 et rupture directionnelle.'],
 ['force-cross','Elder force transition','Force Index EMA 13 de variation × volume ; passage de zéro, EMA 50 et volume réel.'],
 ['eom-cross','Ease of movement transition','Mouvement du médian × amplitude / volume, SMA 14 ; passage de zéro et EMA 50.'],
 ['nvi-reclaim','Negative volume reclaim','NVI base 1000 mis à jour seulement quand le volume baisse ; croisement EMA 21 et EMA 50 du prix.'],
 ['vpt-cross','Volume price transition','VPT cumulatif variation relative × volume ; croisement EMA 21, EMA 50 et volume réel.'],
 ['adl-breakout','Accumulation distribution breakout','ADL cumulatif CLV × volume ; rupture du canal ADL 20 antérieur, rupture du prix et EMA 50.'],
 ['mfi-recovery','Money flow recovery','MFI 14 du prix typique × volume ; sortie 20/80, rupture précédente et régime modéré.']
].map(([id,name,description])=>({id,name,description}));
const finite=Number.isFinite,sum=a=>a.reduce((s,x)=>s+x,0),mean=a=>sum(a)/a.length;
export function emaSeries(values,period){
 let state=null,count=0,oldWeight=1;const alpha=2/(period+1);
 return values.map(value=>{const present=finite(value);if(present)count++;
  if(state===null){if(present)state=value;}
  else {oldWeight*=1-alpha;if(present){state=(oldWeight*state+alpha*value)/(oldWeight+alpha);oldWeight=1;}}
  return count>=period?state:null;});
}
function rolling(values,period,fn=mean){return values.map((_,i)=>{const a=values.slice(i-period+1,i+1);return i>=period-1&&a.every(finite)?fn(a):null;});}
export function tripleEMA(values,period=21){const a=emaSeries(values,period),b=emaSeries(a,period),c=emaSeries(b,period);return a.map((x,i)=>finite(c[i])?3*x-3*b[i]+c[i]:null);}
export function zeroLagEMA(values,period=21){const lag=Math.floor((period-1)/2);return emaSeries(values.map((v,i)=>i>=lag?2*v-values[i-lag]:null),period);}
function stochastic(values,period){return values.map((v,i)=>{const a=values.slice(i-period+1,i+1);if(i<period-1||!a.every(finite))return null;const lo=Math.min(...a),hi=Math.max(...a);return hi>lo?100*(v-lo)/(hi-lo):null;});}
export function expansionContext(bars){
 const b=bars.filter(x=>x.closed!==false),n=b.length;if(n<60)return null;
 const c=b.map(x=>x.close),range=b.map(x=>x.high-x.low),fast=emaSeries(c,23),slow=emaSeries(c,50),macd=c.map((_,i)=>finite(slow[i])?fast[i]-slow[i]:null);
 const stc=emaSeries(stochastic(emaSeries(stochastic(macd,10),3),10),3),tema=tripleEMA(c),zlema=zeroLagEMA(c),sma20=rolling(c,20),dpo=c.map((_,i)=>finite(sma20[i])?c[i-11]-sma20[i]:null);
 const r1=emaSeries(range,9),r2=emaSeries(r1,9),mass=rolling(r1.map((v,i)=>finite(r2[i])&&r2[i]>0?v/r2[i]:null),25,sum);
 const last28=c.slice(-28),path=sum(c.slice(-29).slice(1).map((v,i)=>Math.abs(v-c.slice(-29)[i]))),vhf=path>0?(Math.max(...last28)-Math.min(...last28))/path:null;
 const volumeAvailable=b.slice(-60).every(x=>finite(x.volume)&&x.volume>0);
 let force=[],eom=[],nvi=[],vpt=[],adl=[],mfi=[],nviEma=[],vptEma=[];
 if(volumeAvailable){
  // Leading unavailable history is retained as null; it is never filled with volume.
  const valid=b.every(x=>finite(x.volume)&&x.volume>0);
  if(valid){
   const rawForce=b.map((x,i)=>i?(x.close-b[i-1].close)*x.volume:null);
   force=emaSeries(rawForce,13);eom=rolling(b.map((x,i)=>i?((x.high+x.low-b[i-1].high-b[i-1].low)/2)*(x.high-x.low)/x.volume*1e8:null),14);
   let nv=1000,vp=0,ad=0;nvi=[];vpt=[];adl=[];
   for(let i=0;i<n;i++){const x=b[i];if(i){const change=x.close/b[i-1].close-1;if(x.volume<b[i-1].volume)nv*=1+change;vp+=x.volume*change;}ad+=(x.high>x.low?(2*x.close-x.high-x.low)/(x.high-x.low):0)*x.volume;nvi.push(nv);vpt.push(i?vp:null);adl.push(ad);}
   nviEma=emaSeries(nvi,21);vptEma=emaSeries(vpt,21);
   const typical=b.map(x=>(x.high+x.low+x.close)/3),pos=b.map((x,i)=>i&&typical[i]>typical[i-1]?typical[i]*x.volume:0),neg=b.map((x,i)=>i&&typical[i]<typical[i-1]?typical[i]*x.volume:0),ps=rolling(pos,14,sum),ns=rolling(neg,14,sum);
   mfi=ps.map((v,i)=>finite(v)&&finite(ns[i])&&(v+ns[i])>0?100*v/(v+ns[i]):null);
  }
 }
 const pair=a=>({current:a.at(-1)??null,previous:a.at(-2)??null});
 return {contiguous:b.slice(-60).every((x,i,a)=>!i||Date.parse(x.time)-Date.parse(a[i-1].time)===900000),volumeAvailable,
  tema:pair(tema),zlema:pair(zlema),stc:pair(stc),dpo:pair(dpo),mass:pair(mass),massBulge:mass.slice(-11,-1).some(v=>finite(v)&&v>27),vhf,
  force:pair(force),eom:pair(eom),nvi:pair(nvi),nviEma:pair(nviEma),vpt:pair(vpt),vptEma:pair(vptEma),adl:pair(adl),adlHigh:adl.length?Math.max(...adl.slice(-21,-1)):null,adlLow:adl.length?Math.min(...adl.slice(-21,-1)):null,mfi:pair(mfi)};
}
export function expansionChecks(q,id){
 const a=q.expansion,x=q.last,p=q.previous,check=(label,passed)=>({label,passed:Boolean(passed)});
 const common=[check('60 bougies clôturées consécutives',a?.contiguous),check('Corps ≥ 0,2 ATR',Math.abs(x.close-x.open)>=.2*q.atr)];
 const pair=(buy,sell,labels,volume=false)=>({BUY:[...common,check('Corps haussier',x.close>x.open),...(volume?[check('Volume réel sur la fenêtre',a?.volumeAvailable)]:[]),...buy.map((v,i)=>check(labels[i],v))],SELL:[...common,check('Corps baissier',x.close<x.open),...(volume?[check('Volume réel sur la fenêtre',a?.volumeAvailable)]:[]),...sell.map((v,i)=>check(labels[i],v))]});
 if(!a)return pair([false],[false],['Indicateurs disponibles']);
 const trendBuy=x.close>q.e50,trendSell=x.close<q.e50,breakBuy=x.close>p.high,breakSell=x.close<p.low;
 const cross=(v,level)=>finite(v?.previous)&&finite(v.current)?[v.previous<=level&&v.current>level,v.previous>=level&&v.current<level]:[false,false];
 if(['tema-reclaim','zlema-reclaim'].includes(id)){const v=a[id.startsWith('tema')?'tema':'zlema'];return pair([finite(v.previous)&&p.close<=v.previous&&x.close>v.current,v.current>v.previous,trendBuy],[finite(v.previous)&&p.close>=v.previous&&x.close<v.current,v.current<v.previous,trendSell],['Nouvelle réintégration clôturée','Pente directionnelle','EMA 50']);}
 if(id==='vhf-breakout')return pair([finite(a.vhf)&&a.vhf>=.4,x.close>q.high,trendBuy],[finite(a.vhf)&&a.vhf>=.4,x.close<q.low,trendSell],['VHF 28 ≥ 0,4','Canal 20 antérieur franchi','EMA 50']);
 if(id==='stc-recovery')return pair([cross(a.stc,25)[0]&&a.stc.current<75,breakBuy,trendBuy],[cross(a.stc,75)[1]&&a.stc.current>25,breakSell,trendSell],['Sortie STC 25/75','Rupture précédente','EMA 50']);
 if(id==='dpo-recovery')return pair([cross(a.dpo,0)[0],breakBuy,q.trend<1.2],[cross(a.dpo,0)[1],breakSell,q.trend<1.2],['DPO causal franchit zéro','Rupture précédente','Régime modéré']);
 if(id==='mass-reversal')return pair([a.massBulge&&cross(a.mass,26.5)[1],breakBuy,q.trend<1.2],[a.massBulge&&cross(a.mass,26.5)[1],breakSell,q.trend<1.2],['Bulge > 27 puis Mass < 26,5','Rupture précédente','Régime modéré']);
 if(['force-cross','eom-cross'].includes(id)){const v=a[id.startsWith('force')?'force':'eom'];return pair([cross(v,0)[0],breakBuy,trendBuy],[cross(v,0)[1],breakSell,trendSell],['Passage de zéro','Rupture précédente','EMA 50'],true);}
 if(['nvi-reclaim','vpt-cross'].includes(id)){const key=id.startsWith('nvi')?'nvi':'vpt',v=a[key],ema=a[key+'Ema'];return pair([finite(v.previous)&&finite(ema.previous)&&v.previous<=ema.previous&&v.current>ema.current,breakBuy,trendBuy],[finite(v.previous)&&finite(ema.previous)&&v.previous>=ema.previous&&v.current<ema.current,breakSell,trendSell],['Nouveau croisement EMA 21 de l’indice','Rupture précédente','EMA 50 du prix'],true);}
 if(id==='adl-breakout')return pair([finite(a.adl.current)&&a.adl.current>a.adlHigh,breakBuy,trendBuy],[finite(a.adl.current)&&a.adl.current<a.adlLow,breakSell,trendSell],['Canal ADL 20 antérieur franchi','Rupture précédente','EMA 50'],true);
 if(id==='mfi-recovery')return pair([cross(a.mfi,20)[0]&&a.mfi.current<65,breakBuy,q.trend<1.2],[cross(a.mfi,80)[1]&&a.mfi.current>35,breakSell,q.trend<1.2],['MFI sort de zone 20/80','Rupture précédente','Régime modéré'],true);
 throw Error('Stratégie inconnue');
}
