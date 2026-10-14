import {tradeEntryPolicy,tradeMaxEntryDelayMs} from './trade-outcome.mjs';
// Original research recipes. No promotion, probabilities or live routing here.
const definitions=[
 ['rsi2-trend-recovery','RSI 2 · tendance longue','reversion',1,'RSI Wilder 2 franchit 10/90, clôture au-delà de EMA 200 et corps directionnel.'],
 ['ema200-engulfing','EMA 200 · engulfing','price-structure',1.5,'Engulfing strict du corps précédent, EMA 200 inclinée et clôture du même côté.'],
 ['atr-expansion-channel','Expansion ATR · canal 20','breakout',1.5,'Corps > 1,5 ATR, clôture franchissant le canal des 20 bougies précédentes et EMA 50.'],
 ['utc-asian-range','Range UTC 00–07 · cassure','session',1.5,'Range complet des 28 bougies UTC 00:00–06:45, premier franchissement clôturé entre 07:00 et 10:00 UTC.'],
 ['daily-vwap-reentry','VWAP quotidien · réintégration','reversion',1,'Prix précédent à plus de 2 ATR du VWAP UTC, retour à moins de 1,5 ATR avec corps directionnel ; volume réel requis.'],
 ['regression40-reentry','Régression 40 · réintégration','reversion',1,'Résidu précédent au-delà de 2 écarts-types, retour sous 1,5, pente absolue < 0,1 ATR par bougie.']
];
export const researchCandidateVersion='research-recipes-v1';
export const researchCandidates=Object.freeze(definitions.map(([id,name,family,targetR,description])=>Object.freeze({id,name,family,description,conditions:description,status:'research',version:researchCandidateVersion,warmupBars:220,h1Policy:'research-compare-only',entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,instruments:['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX'],data:{timeframeMinutes:15,closedCandles:true,volume:id==='daily-vwap-reentry'?'required':'optional'},parameters:{atrStop:1.4,targetR,expiryBars:16},provenance:{kind:'original-public-formulas',sourceModule:'research-candidates.mjs',notice:'research/RESEARCH-LAB.md'}})));
function ema(values,n){let value=values.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<values.length;i++)value+=(values[i]-value)*2/(n+1);return value;}
function rsi2(values){let gain=0,loss=0;for(let i=1;i<=2;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0)/2;loss+=Math.max(-d,0)/2;}for(let i=3;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain+Math.max(d,0))/2;loss=(loss+Math.max(-d,0))/2;}return loss===0?gain===0?50:100:100-100/(1+gain/loss);}
function regression(values){const n=values.length,m=values.reduce((a,b)=>a+b,0)/n,mid=(n-1)/2;let xy=0,xx=0;for(let i=0;i<n;i++){xy+=(i-mid)*(values[i]-m);xx+=(i-mid)**2;}const slope=xy/xx,residuals=values.map((v,i)=>v-(m+slope*(i-mid))),sd=Math.sqrt(residuals.reduce((a,b)=>a+b*b,0)/n);return {slope,z:sd>0?residuals.at(-1)/sd:0};}
export function researchContext(bars,q){
 const b=bars.filter(x=>x.closed!==false).slice(-240);
 if(b.length<220||!q||!Number.isFinite(q.atr)||q.atr<=0||b.some((v,i)=>!Number.isFinite(Date.parse(v.time))||Date.parse(v.time)%900000!==0||![v.open,v.high,v.low,v.close].every(x=>Number.isFinite(x)&&x>0)||v.high<Math.max(v.open,v.close,v.low)||v.low>Math.min(v.open,v.close,v.high)||i&&Date.parse(v.time)-Date.parse(b[i-1].time)!==900000))return null;
 const c=b.map(x=>x.close),x=b.at(-1),p=b.at(-2),day=x.time.slice(0,10),today=b.filter(v=>v.time.slice(0,10)===day),opening=today.filter(v=>new Date(v.time).getUTCHours()<7),end=Date.parse(x.time)+900000,date=new Date(end),reg=regression(c.slice(-40)),prior=regression(c.slice(-41,-1));
 const vwap=rows=>{if(rows.length<16||rows.some(v=>!Number.isFinite(v.volume)||v.volume<=0||v.volumeUnavailable))return null;return rows.reduce((s,v)=>s+(v.high+v.low+v.close)/3*v.volume,0)/rows.reduce((s,v)=>s+v.volume,0);};
 return {x,p,atr:q.atr,e50:q.e50,e200:ema(c,200),previousE200:ema(c.slice(0,-1),200),rsi2:rsi2(c),previousRsi2:rsi2(c.slice(0,-1)),high20:Math.max(...b.slice(-21,-1).map(v=>v.high)),low20:Math.min(...b.slice(-21,-1).map(v=>v.low)),sessionReady:opening.length===28&&Date.parse(opening[0].time)%86400000===0&&date.toISOString().slice(0,10)===day,sessionHour:date.getUTCHours()+date.getUTCMinutes()/60,dayHigh:Math.max(...opening.map(v=>v.high)),dayLow:Math.min(...opening.map(v=>v.low)),vwap:vwap(today),previousVwap:vwap(today.slice(0,-1)),previousAtr:q.previousAtr,z:reg.z,previousZ:prior.z,slopeAtr:reg.slope/q.atr};
}
export function researchSignal(context,id){
 const rule=researchCandidates.find(r=>r.id===id),hold={side:'HOLD',strategy:id,reason:'Configuration de recherche absente'};
 if(!context||!rule)return hold;
 const {x,p,atr}=context;if(!x||!p||!Number.isFinite(atr)||atr<=0)return hold;
 const c=context,bull=x.close>x.open,bear=x.close<x.open;let buy=false,sell=false;
 if(id==='rsi2-trend-recovery'){buy=c.previousRsi2<=10&&c.rsi2>10&&c.rsi2<70&&x.close>c.e200&&bull;sell=c.previousRsi2>=90&&c.rsi2<90&&c.rsi2>30&&x.close<c.e200&&bear;}
 if(id==='ema200-engulfing'){buy=p.close<p.open&&x.open<p.close&&x.close>p.open&&x.close>c.e200&&c.e200>c.previousE200;sell=p.close>p.open&&x.open>p.close&&x.close<p.open&&x.close<c.e200&&c.e200<c.previousE200;}
 if(id==='atr-expansion-channel'){buy=x.close-x.open>1.5*atr&&x.close>c.high20&&p.close<=c.high20&&x.close>c.e50;sell=x.open-x.close>1.5*atr&&x.close<c.low20&&p.close>=c.low20&&x.close<c.e50;}
 if(id==='utc-asian-range'&&c.sessionReady&&c.sessionHour>=7&&c.sessionHour<10){buy=p.close<=c.dayHigh&&x.close>c.dayHigh&&bull;sell=p.close>=c.dayLow&&x.close<c.dayLow&&bear;}
 if(id==='daily-vwap-reentry'&&c.vwap!==null&&c.previousVwap!==null&&Number.isFinite(c.previousAtr)&&c.previousAtr>0){buy=p.close<c.previousVwap-2*c.previousAtr&&x.close>=c.vwap-1.5*atr&&x.close<c.vwap&&bull;sell=p.close>c.previousVwap+2*c.previousAtr&&x.close<=c.vwap+1.5*atr&&x.close>c.vwap&&bear;}
 if(id==='regression40-reentry'&&Math.abs(c.slopeAtr)<.1){buy=c.previousZ<=-2&&c.z>-1.5&&c.z<0&&bull;sell=c.previousZ>=2&&c.z<1.5&&c.z>0&&bear;}
 if(buy===sell)return hold;
 const direction=buy?1:-1,risk=rule.parameters.atrStop*atr,entry=x.close,stop=entry-direction*risk,target=entry+direction*risk*rule.parameters.targetR;
 if(![entry,stop,target].every(v=>Number.isFinite(v)&&v>0))return hold;
 return {side:buy?'BUY':'SELL',strategy:id,entry,stop,target,atr,riskDistance:risk,reason:rule.description,researchOnly:true};
}
