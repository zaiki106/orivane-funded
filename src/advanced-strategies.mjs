// Original browser implementation of public technical-analysis formulas.
// Formula references and upstream MIT notice: THIRD_PARTY_NOTICES.md.
export const advancedStrategies=[
 ['alma-reclaim','ALMA reclaim','ALMA 21, sigma 6, offset 0,85 ; nouvelle réintégration, pente et EMA 50.'],
 ['hma-reclaim','Hull reclaim','HMA 21 = WMA 4 de (2 WMA 10 − WMA 21) ; réintégration et pente.'],
 ['regression-trend','Regression trend','Régression OLS 20 clôtures ; R² ≥ 0,6, pente ≥ 0,05 ATR et rupture précédente.'],
 ['regression-reentry','Regression channel recovery','Excès précédent de 2 écarts résiduels, retour dans 1,5 écart et corps confirmé.'],
 ['efficiency-trend','Efficiency trend','ER 10 ≥ 0,6, tendance EMA 21/50, rupture précédente et corps ≥ 0,2 ATR.'],
 ['chop-breakout','Choppiness breakout','CHOP 14 < 38,2, clôture hors du canal 20 passé et corps ≥ 0,2 ATR.'],
 ['cmo-recovery','Chande recovery','CMO par sommes 14 : sortie −50/+50, rupture précédente et régime modéré.'],
 ['coppock-cross','Coppock intraday adaptation','WMA 10 de ROC 11 + ROC 14 ; croisement de zéro. Adaptation 15m, non modèle mensuel.'],
 ['kst-cross','KST momentum','ROC 10/15/20/30 lissés SMA 10/10/10/15, poids 1/2/3/4 ; croisement SMA 9.'],
 ['cmf-breakout','Chaikin flow breakout','CMF 20 franchit ±0,1, rupture précédente et EMA 50 ; volume réel requis.'],
 ['utc-opening-range','UTC opening range','Première heure UTC complète (00:00–01:00), premier franchissement clôturé avant 04:00 UTC.'],
 ['previous-day-breakout','Previous UTC day breakout','96 bougies du jour UTC précédent requises ; premier franchissement de son extrême.']
].map(([id,name,description])=>({id,name,description}));
const sum=a=>a.reduce((s,x)=>s+x,0),mean=a=>sum(a)/a.length;
export function weightedMean(a){return sum(a.map((v,i)=>v*(i+1)))/(a.length*(a.length+1)/2);}
function sma(a,n){return a.map((_,i)=>i<n-1||a.slice(i-n+1,i+1).some(v=>!Number.isFinite(v))?null:mean(a.slice(i-n+1,i+1)));}
function wma(a,n){return a.map((_,i)=>i<n-1||a.slice(i-n+1,i+1).some(v=>!Number.isFinite(v))?null:weightedMean(a.slice(i-n+1,i+1)));}
export function linearRegression(values){
 const n=values.length,mx=(n-1)/2,my=mean(values),xx=sum(values.map((_,i)=>(i-mx)**2)),xy=sum(values.map((y,i)=>(i-mx)*(y-my)));
 if(n<2||xx<=0)return null;const slope=xy/xx,intercept=my-slope*mx,residuals=values.map((y,i)=>y-intercept-slope*i),sse=sum(residuals.map(x=>x*x)),sst=sum(values.map(y=>(y-my)**2));
 return {slope,endpoint:intercept+slope*(n-1),sd:Math.sqrt(sse/n),r2:sst>1e-20?Math.max(0,Math.min(1,1-sse/sst)):0,residual:residuals.at(-1)};
}
export function efficiencyRatio(values,n=10){const a=values.slice(-n-1),path=sum(a.slice(1).map((x,i)=>Math.abs(x-a[i])));return a.length===n+1&&path>0?Math.abs(a.at(-1)-a[0])/path:0;}
export function choppiness(bars,n=14){const a=bars.slice(-n),offset=bars.length-n;let tr=0;for(let i=0;i<a.length;i++){const b=a[i],p=bars[offset+i-1];tr+=Math.max(b.high-b.low,p?Math.abs(b.high-p.close):0,p?Math.abs(b.low-p.close):0);}const range=Math.max(...a.map(b=>b.high))-Math.min(...a.map(b=>b.low));return a.length===n&&range>0&&tr>0?100*Math.log10(tr/range)/Math.log10(n):null;}
function utcLevels(bars){
 const x=bars.at(-1),day=Math.floor(Date.parse(x.time)/86400000)*86400000;
 const whole=rows=>rows.length===96&&rows.every((b,i)=>Date.parse(b.time)===day-86400000+i*900000);
 const yesterday=bars.filter(b=>Date.parse(b.time)>=day-86400000&&Date.parse(b.time)<day),opening=bars.filter(b=>Date.parse(b.time)>=day&&Date.parse(b.time)<day+3600000);
 const openingReady=opening.length===4&&opening.every((b,i)=>Date.parse(b.time)===day+i*900000)&&Date.parse(x.time)>=day+3600000&&Date.parse(x.time)<day+4*3600000;
 return {openingHigh:openingReady?Math.max(...opening.map(b=>b.high)):null,openingLow:openingReady?Math.min(...opening.map(b=>b.low)):null,dayHigh:whole(yesterday)?Math.max(...yesterday.map(b=>b.high)):null,dayLow:whole(yesterday)?Math.min(...yesterday.map(b=>b.low)):null};
}
export function advancedContext(bars){
 const b=bars.filter(x=>x.closed!==false),close=b.map(x=>x.close),n=b.length;
 if(n<60)return null;
 const contiguous=b.slice(-60).every((x,i,a)=>!i||Date.parse(x.time)-Date.parse(a[i-1].time)===900000);
 const weights=Array.from({length:21},(_,i)=>Math.exp(-((i-.85*20)**2)/(2*(21/6)**2))),norm=sum(weights);
 const alma=values=>sum(values.slice(-21).map((x,i)=>x*weights[i]))/norm;
 const short=wma(close,10),long=wma(close,21),hull=wma(close.map((_,i)=>Number.isFinite(short[i])&&Number.isFinite(long[i])?2*short[i]-long[i]:null),4);
 const roc=(i,k)=>i>=k?100*(close[i]/close[i-k]-1):null;
 const coppock=wma(close.map((_,i)=>i>=14?roc(i,11)+roc(i,14):null),10);
 const components=[[10,10],[15,10],[20,10],[30,15]].map(([k,p])=>sma(close.map((_,i)=>roc(i,k)),p));
 const kst=close.map((_,i)=>components.every(c=>Number.isFinite(c[i]))?sum(components.map((c,j)=>c[i]*(j+1))):null),kstSignal=sma(kst,9);
 const cmo=values=>{const a=values.slice(-15),d=a.slice(1).map((x,i)=>x-a[i]),pos=sum(d.map(x=>Math.max(x,0))),neg=sum(d.map(x=>Math.max(-x,0)));return pos+neg>0?100*(pos-neg)/(pos+neg):0;};
 const cmf=rows=>rows.length===20&&rows.every(x=>Number.isFinite(x.volume)&&x.volume>0)?sum(rows.map(x=>x.high>x.low?((2*x.close-x.high-x.low)/(x.high-x.low))*x.volume:0))/sum(rows.map(x=>x.volume)):null;
 return {contiguous,alma:alma(close),previousAlma:alma(close.slice(0,-1)),hma:hull.at(-1),previousHma:hull.at(-2),regression:linearRegression(close.slice(-20)),previousRegression:linearRegression(close.slice(-21,-1)),efficiency:efficiencyRatio(close),chop:choppiness(b),cmo:cmo(close),previousCmo:cmo(close.slice(0,-1)),coppock:coppock.at(-1),previousCoppock:coppock.at(-2),kst:kst.at(-1),previousKst:kst.at(-2),kstSignal:kstSignal.at(-1),previousKstSignal:kstSignal.at(-2),cmf:cmf(b.slice(-20)),previousCmf:cmf(b.slice(-21,-1)),...utcLevels(b)};
}
export function advancedChecks(q,id){
 const a=q.advanced,x=q.last,p=q.previous,c=(label,passed)=>({label,passed:Boolean(passed)}),present=Number.isFinite;
 const common=[c('60 bougies clôturées consécutives',a?.contiguous),c('Corps directionnel ≥ 0,2 ATR',Math.abs(x.close-x.open)>=.2*q.atr)];
 const pair=(buy,sell,labels)=>({BUY:[...common,c('Corps haussier',x.close>x.open),...buy.map((v,i)=>c(labels[i],v))],SELL:[...common,c('Corps baissier',x.close<x.open),...sell.map((v,i)=>c(labels[i],v))]});
 if(!a)return pair([false],[false],['Indicateurs disponibles']);
 const trendBuy=x.close>q.e50,trendSell=x.close<q.e50,breakBuy=x.close>p.high,breakSell=x.close<p.low;
 if(['alma-reclaim','hma-reclaim'].includes(id)){const key=id.startsWith('alma')?'alma':'hma',v=a[key],prev=a[key==='alma'?'previousAlma':'previousHma'];return pair([p.close<=prev,x.close>v,v>prev,trendBuy],[p.close>=prev,x.close<v,v<prev,trendSell],['Prix précédent du côté opposé','Réintégration clôturée','Pente directionnelle','Filtre EMA 50']);}
 if(id==='regression-trend')return pair([a.regression.r2>=.6,a.regression.slope>.05*q.atr,breakBuy,trendBuy],[a.regression.r2>=.6,a.regression.slope<-.05*q.atr,breakSell,trendSell],['R² ≥ 0,6','Pente ≥ 0,05 ATR','Rupture précédente','Filtre EMA 50']);
 if(id==='regression-reentry')return pair([a.previousRegression.sd>0&&a.previousRegression.residual<-2*a.previousRegression.sd,a.regression.residual>-1.5*a.regression.sd,x.close>p.close,q.trend<1.2],[a.previousRegression.sd>0&&a.previousRegression.residual>2*a.previousRegression.sd,a.regression.residual<1.5*a.regression.sd,x.close<p.close,q.trend<1.2],['Excès précédent de 2 écarts','Réintégration 1,5 écart','Clôture directionnelle','Régime modéré']);
 if(id==='efficiency-trend')return pair([a.efficiency>=.6,q.e21>q.e50,breakBuy],[a.efficiency>=.6,q.e21<q.e50,breakSell],['ER 10 ≥ 0,6','EMA 21/50 alignées','Rupture précédente']);
 if(id==='chop-breakout')return pair([present(a.chop)&&a.chop<38.2,x.close>q.high,trendBuy],[present(a.chop)&&a.chop<38.2,x.close<q.low,trendSell],['CHOP 14 < 38,2','Canal 20 passé franchi','Filtre EMA 50']);
 if(id==='cmo-recovery')return pair([a.previousCmo<=-50&&a.cmo>-50&&a.cmo<50,breakBuy,q.trend<1.2],[a.previousCmo>=50&&a.cmo<50&&a.cmo>-50,breakSell,q.trend<1.2],['CMO sort de zone extrême','Rupture précédente','Régime modéré']);
 if(id==='coppock-cross')return pair([a.previousCoppock<=0&&a.coppock>0,trendBuy],[a.previousCoppock>=0&&a.coppock<0,trendSell],['Coppock franchit zéro','Filtre EMA 50']);
 if(id==='kst-cross')return pair([present(a.kst)&&present(a.previousKstSignal)&&a.previousKst<=a.previousKstSignal&&a.kst>a.kstSignal,a.kst>0,trendBuy],[present(a.kst)&&present(a.previousKstSignal)&&a.previousKst>=a.previousKstSignal&&a.kst<a.kstSignal,a.kst<0,trendSell],['Croisement KST / SMA 9','Signe directionnel','Filtre EMA 50']);
 if(id==='cmf-breakout')return pair([present(a.previousCmf)&&present(a.cmf)&&a.previousCmf<=.1&&a.cmf>.1,breakBuy,trendBuy],[present(a.previousCmf)&&present(a.cmf)&&a.previousCmf>=-.1&&a.cmf<-.1,breakSell,trendSell],['Volume réel et franchissement CMF ±0,1','Rupture précédente','Filtre EMA 50']);
 const high=id==='utc-opening-range'?a.openingHigh:a.dayHigh,low=id==='utc-opening-range'?a.openingLow:a.dayLow;
 if(['utc-opening-range','previous-day-breakout'].includes(id))return pair([present(high)&&p.close<=high&&x.close>high,trendBuy],[present(low)&&p.close>=low&&x.close<low,trendSell],['Niveau UTC complet et premier franchissement','Filtre EMA 50']);
 throw Error('Stratégie avancée inconnue');
}
