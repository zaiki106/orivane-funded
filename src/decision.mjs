import {auditProbabilityRows} from './probability-audit.mjs';
import {fitRegularizedLDA,predictRegularizedLDA,validLinearDiscriminant,ldaAlgorithm} from './regularized-lda.mjs';
import {pricePatternChecks} from './price-patterns.mjs';
import {executionPlan} from './execution-plan.mjs';
import {indicators,signal,analysisWindow} from './engine.mjs';
import {costForSymbol} from './cost-policy.mjs';
import {fitNearestNeighbors,predictNearestNeighbors,validNeighborModel,neighborAlgorithm} from './nearest-neighbors.mjs';
import {fitRegularizedQDA,predictRegularizedQDA,validDiscriminantModel,qdaAlgorithm} from './regularized-qda.mjs';
import {fitNeuralNetwork,predictNeuralNetwork,validNeuralModel,neuralAlgorithm} from './neural-network.mjs';

export const classes=['UP','DOWN','FLAT'];
export const featureNames=['return1Atr','return4Atr','return12Atr','emaFastAtr','emaSlowAtr','rsiCentered','macdHistogramAtr','atrFraction','bandPosition','logVolumeRatio','volumeAvailable','h1Direction','h1Available'];
export const decisionVersion='regime-classifier-v5';
export const featureWindow=analysisWindow;
export const signalPolicy=Object.freeze({id:'confidence-above-60-v1',minimumPercent:60,comparison:'>'});
const version=decisionVersion;
const closed=bars=>bars.filter(b=>b.closed!==false);
const clip=(x,min,max)=>Math.max(min,Math.min(max,x));
const average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const quantile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*p)];};
const ema=(values,period)=>values.reduce((value,x,i)=>i?value+(x-value)*2/(period+1):x,0);
const defaultRouter={trendThreshold:.8,highVolatilityThreshold:null,fittedThrough:null};

// A group is a real UTC hour only when all four aligned 15-minute candles exist.
export function aggregateH1(bars){
  const groups=new Map();
  for(const b of closed(bars)){
    const t=Date.parse(b.time);if(!Number.isFinite(t)||t%900000!==0)continue;
    const hour=Math.floor(t/3600000)*3600000;
    if(!groups.has(hour))groups.set(hour,new Map());groups.get(hour).set(t,b);
  }
  const result=[];
  for(const [hour,group] of [...groups].sort((a,b)=>a[0]-b[0])){
    const values=[0,1,2,3].map(i=>group.get(hour+i*900000));if(values.some(x=>!x)||group.size!==4)continue;
    result.push({time:new Date(hour).toISOString(),endTime:new Date(hour+3600000).toISOString(),open:values[0].open,high:Math.max(...values.map(b=>b.high)),low:Math.min(...values.map(b=>b.low)),close:values[3].close,volume:values.reduce((sum,b)=>sum+b.volume,0),closed:true});
  }
  return result;
}

export function higherTimeframe(bars){
  const b=closed(bars),hours=aggregateH1(b),last=hours.at(-1),asOf=Date.parse(b.at(-1)?.time)+900000;
  const base={timeframe:'1h',bars:hours.length,asOf:last?.endTime??null,direction:'NEUTRAL',available:false};
  if(hours.length<21)return {...base,status:'insufficient',why:'Moins de 21 heures complètes : filtre H1 indisponible'};
  if(asOf-Date.parse(last.endTime)>90*60000)return {...base,status:'stale',why:'Dernière heure complète trop ancienne : filtre H1 indisponible'};
  const values=hours.slice(-60).map(b=>b.close),fast=ema(values,9),slow=ema(values,21),previousFast=ema(values.slice(0,-1),9);
  const direction=fast>slow&&fast>previousFast?'UP':fast<slow&&fast<previousFast?'DOWN':'NEUTRAL';
  return {...base,available:true,status:'ready',direction,ema9:fast,ema21:slow,why:'EMA 9/21 sur heures complètes'};
}

function routeFrom(q,h1,router){
  const make=(strategy,regime,why,setupPresent=true)=>({strategy,regime,why,setupPresent,higherTimeframe:h1,version,policy:'regime-structure-v5'});
  if(!q||q.atr<=0)return make('pullback','Unavailable','Historique ou volatilité insuffisants');
  const x=q.last,p=q.previous,compression=q.previousBand.width>0&&q.previousBand.width<=q.squeezeThreshold*.9,body=Math.abs(x.close-x.open),bull=x.close>x.open,bear=x.close<x.open,volumeOK=!q.hasVolume||q.volumeRatio>=1.2,expanded=x.high-x.low>q.atr*.8;
  // Fixed regime + observable structure precedence, before evaluating ONE rule.
  // Compression without a break is a context, not a completed squeeze setup.
  const patternReasons={'breakout-retest':'Cassure du canal 20 puis retest tenu et clôture de confirmation','nr7-breakout':'NR7 strict terminé puis cassure dans la tendance','engulfing-reclaim':'Engloutissement du repli puis reprise EMA 21 confirmée','fractal-breakout':'Fractale confirmée puis premier franchissement en clôture','failed-breakout':'Cassure échouée puis réintégration du canal en clôture','two-bar-pullback':'Deux bougies de repli puis rupture des extrêmes en tendance EMA 21/50'};
  for(const id of Object.keys(patternReasons)){const checks=pricePatternChecks(q,id);if(checks.BUY.every(c=>c.passed)||checks.SELL.every(c=>c.passed))return make(id,'Price structure',patternReasons[id]);}
  if(q.insideBar&&q.patternContiguous&&(x.close>q.mother.high||x.close<q.mother.low)&&x.high-x.low>=q.atr*.5)return make('inside-bar','Compression breakout','Clôture hors de la mère après une bougie intérieure stricte');
  if(q.trend<1.2&&(x.low<q.low&&x.close>q.low&&bull&&Math.min(x.open,x.close)-x.low>=body||x.high>q.high&&x.close<q.high&&bear&&x.high-Math.max(x.open,x.close)>=body))return make('liquidity-sweep','Rejection','Mèche hors du canal passé puis réintégration directionnelle');
  if(compression&&(x.close>q.previousBand.upper||x.close<q.previousBand.lower)&&expanded&&volumeOK)return make('squeeze','Compression breakout','Compression réelle puis rupture de bande, amplitude et volume confirmés');
  // Fresh adaptive, normalized-momentum and oscillator events precede recurring trends.
  if(q.trend<1.2&&q.cci>-100&&q.cci<100&&(q.previousCci<=-100&&bull&&x.close>p.close||q.previousCci>=100&&bear&&x.close<p.close))return make('cci-recovery','Range recovery','CCI 20 revient de sa zone extrême avec une clôture directionnelle');
  if(q.previousAroonUp<=q.previousAroonDown&&q.aroonUp>q.aroonDown&&q.aroonUp>=70&&q.aroonDown<=30&&x.close>q.e50&&bull||q.previousAroonDown<=q.previousAroonUp&&q.aroonDown>q.aroonUp&&q.aroonDown>=70&&q.aroonUp<=30&&x.close<q.e50&&bear)return make('aroon','Trend transition','Nouveau croisement Aroon 25, leader ≥ 70, opposé ≤ 30 et EMA 50 confirmée');
  // A long-channel break in an established strong regime precedes the shorter range rule.
  if(q.adx>=25&&(x.close>q.donchian55High&&x.close>q.e50&&bull||x.close<q.donchian55Low&&x.close<q.e50&&bear))return make('donchian55','Established trend breakout','Canal des 55 bougies passées franchi en régime ADX ≥ 25');
  if((x.close>q.high&&x.close>q.e21||x.close<q.low&&x.close<q.e21)&&expanded&&volumeOK)return make('breakout','Breakout','Clôture hors du canal 20 avec expansion et volume si disponible');
  if(q.previousRoc<=.5&&q.roc>.5&&x.close>q.e50&&bull||q.previousRoc>=-.5&&q.roc<-.5&&x.close<q.e50&&bear)return make('roc-momentum','Momentum transition','ROC 12 franchit ±0,5 % avec EMA 50 et corps directionnel');
  if(q.previousPpo<=q.previousPpoSignal&&q.ppo>q.ppoSignal&&q.ppo>0&&x.close>q.e50&&bull||q.previousPpo>=q.previousPpoSignal&&q.ppo<q.ppoSignal&&q.ppo<0&&x.close<q.e50&&bear)return make('ppo','Normalized momentum transition','Nouveau croisement PPO 12/26 et signal 9 avec signe et EMA 50 confirmés');
  if(q.trend<1.2&&q.williamsR>-80&&q.williamsR<-20&&(q.previousWilliamsR<=-80&&x.close>p.high||q.previousWilliamsR>=-20&&x.close<p.low))return make('williams-recovery','Range recovery','Williams %R 14 sort de zone extrême et rompt la bougie précédente');
  if(q.trend<1.2&&q.ultimate>30&&q.ultimate<70&&(q.previousUltimate<=30&&bull&&x.close>p.close||q.previousUltimate>=70&&bear&&x.close<p.close))return make('ultimate-recovery','Buying-pressure recovery','Ultimate 7/14/28 quitte 30/70 avec bougie et prix directionnels');
  if(q.trend<1.2&&(q.previousSmi<=-40&&q.previousSmi<=q.previousSmiSignal&&q.smi>q.smiSignal&&q.smi<40&&bull&&x.close>p.close||q.previousSmi>=40&&q.previousSmi>=q.previousSmiSignal&&q.smi<q.smiSignal&&q.smi>-40&&bear&&x.close<p.close))return make('smi','Midpoint momentum reversal','Premier croisement SMI 5/3/3 depuis ±40, prix confirmé');
  if(q.trend<1.2&&q.stochRsiK>20&&q.stochRsiK<80&&(q.previousStochRsiK<=20&&q.stochRsiK>q.stochRsiD&&bull&&x.close>p.close||q.previousStochRsiK>=80&&q.stochRsiK<q.stochRsiD&&bear&&x.close<p.close))return make('stoch-rsi','RSI momentum recovery','Stoch RSI 14/14, K3/D3 : sortie de 20/80 avec D et prix confirmés');
  if(q.trend<1.2&&q.demarker>.3&&q.demarker<.7&&(q.previousDemarker<=.3&&bull&&x.close>p.close||q.previousDemarker>=.7&&bear&&x.close<p.close))return make('demarker','High-low pressure recovery','DeMarker 14 quitte 0,3/0,7 avec prix directionnel');
  if(q.previousAwesome<=0&&q.awesome>0&&x.close>q.e50&&bull||q.previousAwesome>=0&&q.awesome<0&&x.close<q.e50&&bear)return make('awesome','Median-price momentum transition','Awesome médian SMA 5/34 franchit zéro avec EMA 50 et corps directionnel');

  if(p.close<=q.previousKama&&x.close>q.kama&&q.kama>q.previousKama&&x.close>q.e50&&bull||p.close>=q.previousKama&&x.close<q.kama&&q.kama<q.previousKama&&x.close<q.e50&&bear)return make('kama-reclaim','Adaptive trend reclaim','Nouvelle réintégration de KAMA 10/2/30 avec pente, EMA 50 et corps directionnel');
  if(q.trend<1.2&&(q.previousFisher<=-1&&q.previousFisher<=q.previousFisherTrigger&&q.fisher>q.fisherTrigger&&bull&&x.close>p.close||q.previousFisher>=1&&q.previousFisher>=q.previousFisherTrigger&&q.fisher<q.fisherTrigger&&bear&&x.close<p.close))return make('fisher-recovery','Oscillator reversal','Premier retournement Fisher 10 depuis ±1 avec prix directionnel');
  if(q.previousSarDirection===-1&&q.sarDirection===1&&x.close>q.sar&&x.close>q.e21&&bull||q.previousSarDirection===1&&q.sarDirection===-1&&x.close<q.sar&&x.close<q.e21&&bear)return make('parabolic-sar','Trailing reversal','Retournement SAR Wilder confirmé au-delà de SAR et EMA 21');
  if(p.close<=q.previousChandelierShort&&x.close>q.previousChandelierShort&&x.close>q.chandelierLong&&x.close>q.e50&&bull||p.close>=q.previousChandelierLong&&x.close<q.previousChandelierLong&&x.close<q.chandelierShort&&x.close<q.e50&&bear)return make('chandelier','Trailing reversal','Clôture au-delà de la sortie Chandelier terminée, EMA 50 et stop courant cohérents');
  if(q.previousVortexPlus<=q.previousVortexMinus&&q.vortexPlus>q.vortexMinus&&x.close>q.e50&&bull||q.previousVortexMinus<=q.previousVortexPlus&&q.vortexMinus>q.vortexPlus&&x.close<q.e50&&bear)return make('vortex','Directional transition','Nouveau croisement Vortex 14 avec EMA 50 et corps directionnel');
  if(q.previousTrix<=q.previousTrixSignal&&q.trix>q.trixSignal&&q.trix>0&&x.close>q.e50&&bull||q.previousTrix>=q.previousTrixSignal&&q.trix<q.trixSignal&&q.trix<0&&x.close<q.e50&&bear)return make('trix','Smoothed momentum','Nouveau croisement TRIX triple EMA 15 et signal 9, signe et EMA 50 confirmés');
  if(q.previousTsi<=q.previousTsiSignal&&q.tsi>q.tsiSignal&&q.tsi>0&&x.close>q.e50&&bull||q.previousTsi>=q.previousTsiSignal&&q.tsi<q.tsiSignal&&q.tsi<0&&x.close<q.e50&&bear)return make('tsi','Smoothed momentum','Nouveau croisement TSI 25/13 et signal 7, signe et EMA 50 confirmés');
  if(p.close<=q.previousDema&&x.close>q.dema&&q.dema>q.previousDema&&x.close>q.e50&&bull||p.close>=q.previousDema&&x.close<q.dema&&q.dema<q.previousDema&&x.close<q.e50&&bear)return make('dema-reclaim','Trend reclaim','Clôture réintègre DEMA 21 avec pente, EMA 50 et corps directionnel');
  if(q.adx>=25&&q.adx>=q.previousAdx&&(q.diPlus>q.diMinus&&x.close>q.e50&&x.close>p.high||q.diMinus>q.diPlus&&x.close<q.e50&&x.close<p.low))return make('adx-continuation','Strong trend continuation','ADX Wilder ≥ 25 non décroissant, DI, EMA 50 et rupture précédente');
  if(Number.isFinite(q.cloudTop)&&Number.isFinite(q.cloudBottom)&&(q.tenkan>q.kijun&&x.close>q.cloudTop&&x.close>q.chikouReference&&x.close>p.high||q.tenkan<q.kijun&&x.close<q.cloudBottom&&x.close<q.chikouReference&&x.close<p.low))return make('ichimoku','Cloud trend continuation','Tenkan/Kijun alignés et clôture hors du nuage connu, issu de t−26');
  if(q.trend<1.2&&(p.close<q.previousKeltnerLower&&x.close>=q.keltnerLower&&bull&&q.rsi<50||p.close>q.previousKeltnerUpper&&x.close<=q.keltnerUpper&&bear&&q.rsi>50))return make('keltner-reentry','Range recovery','Excès ATR précédent puis réintégration du canal Keltner');
  if(q.trend<1.2&&(q.previousStochastic<=20&&q.stochastic>20&&q.stochastic<65&&q.stochastic>q.stochasticD&&x.close>p.close||q.previousStochastic>=80&&q.stochastic>35&&q.stochastic<80&&q.stochastic<q.stochasticD&&x.close<p.close))return make('stochastic','Range recovery','Stochastique en sortie de zone extrême avec %D et prix confirmés');
  if(q.previousRsi<=30&&q.rsi>30&&q.rsi<55&&x.close>p.high||q.previousRsi>=70&&q.rsi>45&&q.rsi<70&&x.close<p.low)return make('rsi-recovery','Recovery','RSI sort de zone extrême avec rupture de confirmation');
  if(q.previousE9<=q.previousE21&&q.e9>q.e21&&x.close>q.e50&&bull||q.previousE9>=q.previousE21&&q.e9<q.e21&&x.close<q.e50&&bear)return make('ema-cross','Transition','Nouveau croisement EMA 9/21 confirmé par le prix');
  if(q.previousMacd<=q.previousMacdSignal&&q.macd>q.macdSignal&&x.close>q.e50&&x.close>p.close||q.previousMacd>=q.previousMacdSignal&&q.macd<q.macdSignal&&x.close<q.e50&&x.close<p.close)return make('macd','Momentum','Nouveau croisement MACD confirmé par le prix');
  const supertrendSetup=q.supertrendDirection===1&&x.close>p.high&&x.close-x.open>=q.atr*.25||q.supertrendDirection===-1&&x.close<p.low&&x.open-x.close>=q.atr*.25;
  if(q.supertrendDirection!==q.previousSupertrendDirection&&supertrendSetup)return make('supertrend','Trend reversal','Bascule Supertrend avec rupture et corps directionnel');
  if(q.elderEma>q.previousElderEma&&q.bearsPower<0&&q.bearsPower>q.previousBearsPower&&x.close>q.elderEma&&bull||q.elderEma<q.previousElderEma&&q.bullsPower>0&&q.bullsPower<q.previousBullsPower&&x.close<q.elderEma&&bear)return make('elder-ray','Opposing-pressure pullback','Puissance opposée Elder Ray qui se résorbe avec EMA 13 directionnelle et corps confirmé');
  const aligned=q.e9>q.e21&&q.e21>q.e50||q.e9<q.e21&&q.e21<q.e50;
  if(aligned&&q.trend>router.trendThreshold){
    if(q.e9>q.e21&&p.low<=q.previousE9&&x.close>p.high&&q.rsi>45&&q.rsi<72||q.e9<q.e21&&p.high>=q.previousE9&&x.close<p.low&&q.rsi>28&&q.rsi<55)return make('pullback','Trend pullback','Repli EMA 9 terminé puis rupture de reprise');
    if(q.hasVolume&&(p.low<=q.previousVwap&&x.close>q.vwap&&q.e21>q.previousE21&&x.close>p.high||p.high>=q.previousVwap&&x.close<q.vwap&&q.e21<q.previousE21&&x.close<p.low))return make('vwap','Trend pullback','Repli VWAP glissante et rupture de reprise confirmés');
    return make('continuation','Trend','Tendance persistante : chercher un corps directionnel, sans exiger un nouveau croisement',body>=q.atr*.2);
  }
  if(q.trend<.65&&(p.close<q.previousBand.lower&&x.close>=q.lower&&x.close>p.close&&q.rsi<45||p.close>q.previousBand.upper&&x.close<=q.upper&&x.close<p.close&&q.rsi>55))return make('reversion','Range recovery','Excès Bollinger précédent et réintégration confirmée');
  if(supertrendSetup)return make('supertrend','Directional continuation','Supertrend établi avec rupture précédente et corps directionnel');
  if(q.trend<.65)return make('stochastic','Range','Marché peu directionnel : attendre un retournement stochastique confirmé',false);
  return make('continuation','Transition','Aucune structure terminée : attendre une continuation EMA confirmée',false);
}

export function routeStrategy(bars,router=defaultRouter){
  const b=closed(bars),asOf=Date.parse(b.at(-1)?.time)+900000;
  const fitted=router?.fittedThrough&&Date.parse(router.fittedThrough)>asOf?defaultRouter:{...defaultRouter,...router};
  return routeFrom(indicators(b.slice(-featureWindow)),higherTimeframe(b),fitted);
}

function featurePoint(bars,index){
  if(!Number.isInteger(index)||index<59||index>=bars.length)return null;
  const history=bars.slice(Math.max(0,index-featureWindow+1),index+1),q=indicators(history);if(!q||q.atr<=0)return null;
  const x=q.last.close,atr=q.atr,h1=higherTimeframe(history);
  const features=[(x-bars[index-1].close)/atr,(x-bars[index-4].close)/atr,(x-bars[index-12].close)/atr,(q.e9-q.e21)/atr,(q.e21-q.e50)/atr,(q.rsi-50)/50,(q.macd-q.macdSignal)/atr,atr/x,(x-q.mean)/Math.max(2*q.sd,atr*.1),q.hasVolume?Math.log1p(q.volumeRatio)-Math.log(2):0,q.hasVolume?1:0,h1.available?(h1.direction==='UP'?1:h1.direction==='DOWN'?-1:0):0,h1.available?1:0];
  if(features.some(x=>!Number.isFinite(x)))return null;
  return {index,time:bars[index].time,features,atr,atrFraction:atr/x,trend:q.trend};
}

function labelFrom(bars,index,atr,{horizonBars,neutralAtr,cost,timeframe}){
  if(index+horizonBars>=bars.length)return null;
  const interval=timeframe*60000;
  for(let i=index+1;i<=index+horizonBars;i++)if(Date.parse(bars[i].time)-Date.parse(bars[i-1].time)!==interval)return null;
  const grossReturn=bars[index+horizonBars].close/bars[index].close-1,roundTripCost=2*(cost.feeBps+cost.slippageBps)/10000,neutralBand=neutralAtr*atr/bars[index].close+roundTripCost;
  return {label:grossReturn>neutralBand?'UP':grossReturn< -neutralBand?'DOWN':'FLAT',grossReturn,neutralBand,roundTripCost,labelEndIndex:index+horizonBars,labelEndTime:new Date(Date.parse(bars[index+horizonBars].time)+interval).toISOString()};
}

function configuration(dataset={},options={}){
  const config={horizonBars:4,timeframe:dataset.timeframe??15,neutralAtr:.35,maxHistory:2000,minTrainSamples:120,minCalibrationSamples:50,minClassSamples:5,minCalibrationClassSamples:3,minTestSamples:40,iterations:400,regularization:.01,...options,cost:{...costForSymbol(dataset.symbol),...options.cost}};
  if(config.timeframe!==15||!Number.isInteger(config.horizonBars)||config.horizonBars<1||config.horizonBars>32||!Number.isInteger(config.maxHistory)||config.maxHistory<200||config.maxHistory>10000||!Number.isFinite(config.neutralAtr)||config.neutralAtr<0||![config.cost.feeBps,config.cost.slippageBps].every(x=>Number.isFinite(x)&&x>=0&&x<=1000))throw Error('Configuration du modèle invalide');
  for(const key of ['minTrainSamples','minCalibrationSamples','minClassSamples','minCalibrationClassSamples','minTestSamples','iterations'])if(!Number.isInteger(config[key])||config[key]<1||config[key]>10000)throw Error('Configuration du modèle invalide');
  if(!Number.isFinite(config.regularization)||config.regularization<0||config.regularization>10)throw Error('Configuration du modèle invalide');
  return config;
}

export function labelOutcome(bars,index,options={}){
  const b=closed(bars),config=configuration({timeframe:15},options),point=featurePoint(b,index);
  return point?labelFrom(b,index,point.atr,config):null;
}

export function classificationSamples(bars,options={}){
  const b=closed(bars),config=configuration({timeframe:15},options),samples=[];
  for(let i=59;i<b.length;i++){const point=featurePoint(b,i);if(!point)continue;const label=labelFrom(b,i,point.atr,config);if(label)samples.push({...point,...label});}
  return samples;
}

function standardizer(rows){
  const mean=featureNames.map((_,j)=>average(rows.map(r=>r.features[j]))),scale=mean.map((m,j)=>Math.sqrt(average(rows.map(r=>(r.features[j]-m)**2)))||1);
  return {mean,scale};
}
function transform(features,scaler){return [1,...features.map((x,j)=>clip((x-scaler.mean[j])/scaler.scale[j],-5,5))];}
function softmax(logits,temperature=1){const scaled=logits.map(x=>x/temperature),largest=Math.max(...scaled),values=scaled.map(x=>Math.exp(x-largest)),total=values.reduce((sum,x)=>sum+x,0);return values.map(x=>x/total);}
function neighborPrediction(features,model,excludeIndex=null){return predictNearestNeighbors(features,{...model.neighbors,k:model.neighborCount??model.neighbors?.k},model.scaler,{excludeIndex});}
function probabilities(features,model,temperature=model.temperature??1,excludeIndex=null){
  if(model.algorithm===neighborAlgorithm)return neighborPrediction(features,model,excludeIndex)?.probabilities??null;
  if(model.algorithm===ldaAlgorithm)return predictRegularizedLDA(features,model.linearDiscriminant,model.scaler,{temperature});
  if(model.algorithm===qdaAlgorithm)return predictRegularizedQDA(features,model.discriminant,model.scaler,{temperature});
  if(model.algorithm===neuralAlgorithm)return predictNeuralNetwork(features,model.neural,model.scaler,{temperature});
  const x=transform(features,model.scaler);return softmax(model.weights.map(row=>row.reduce((sum,weight,j)=>sum+weight*x[j],0)),temperature);
}
const counts=rows=>Object.fromEntries(classes.map(label=>[label,rows.filter(row=>row.label===label).length]));

function fitLogistic(rows,scaler,config){
  const n=rows.length,dimension=featureNames.length+1,distribution=counts(rows),weights=classes.map(label=>[Math.log(distribution[label]/n),...Array(dimension-1).fill(0)]),samples=rows.map(row=>({x:transform(row.features,scaler),label:classes.indexOf(row.label)}));
  for(let iteration=0;iteration<config.iterations;iteration++){
    const gradient=classes.map(()=>Array(dimension).fill(0));
    for(const sample of samples){const p=softmax(weights.map(row=>row.reduce((sum,weight,j)=>sum+weight*sample.x[j],0)));for(let k=0;k<3;k++){const error=p[k]-(sample.label===k?1:0);for(let j=0;j<dimension;j++)gradient[k][j]+=error*sample.x[j];}}
    const rate=.12/(1+iteration/400);
    for(let k=0;k<3;k++)for(let j=0;j<dimension;j++)weights[k][j]-=rate*(gradient[k][j]/n+(j?config.regularization*weights[k][j]:0));
  }
  return weights;
}

function diagnostics(rows,model,temperature=model.temperature??1,{excludeTrainingSelf=false}={}){
  const n=rows.length,prior=model.classPrior??[1/3,1/3,1/3],reliability=Object.fromEntries(classes.map(label=>[label,Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,n:0,probabilitySum:0,positive:0}))]));
  let brier=0,logLoss=0,baseBrier=0,baseLogLoss=0,correct=0;
  for(const row of rows){const p=probabilities(row.features,model,temperature,excludeTrainingSelf?row.index:null),actual=classes.indexOf(row.label);if(p.indexOf(Math.max(...p))===actual)correct++;
    for(let k=0;k<3;k++){const y=k===actual?1:0;brier+=(p[k]-y)**2;baseBrier+=(prior[k]-y)**2;const bin=reliability[classes[k]][Math.min(9,Math.floor(p[k]*10))];bin.n++;bin.probabilitySum+=p[k];bin.positive+=y;}
    logLoss-=Math.log(Math.max(p[actual],1e-15));baseLogLoss-=Math.log(Math.max(prior[actual],1e-15));
  }
  let calibrationError=0;
  for(const label of classes)reliability[label]=reliability[label].map(({probabilitySum,positive,...bin})=>{const meanProbability=bin.n?probabilitySum/bin.n:null,observedFrequency=bin.n?positive/bin.n:null;if(bin.n)calibrationError+=bin.n*Math.abs(meanProbability-observedFrequency);return {...bin,meanProbability,observedFrequency};});
  let sampleWithoutOverlap=0,lastEnd=-1;for(const row of rows)if(row.index>=lastEnd){sampleWithoutOverlap++;lastEnd=row.labelEndIndex;}
  return {sample:n,sampleWithoutOverlap,classSamples:counts(rows),brier:n?brier/n:null,logLoss:n?logLoss/n:null,baselineBrier:n?baseBrier/n:null,baselineLogLoss:n?baseLogLoss/n:null,brierSkill:n&&baseBrier>0?1-brier/baseBrier:null,accuracy:n?correct/n:null,calibrationError:n?calibrationError/(3*n):null,reliability,overlappingTargets:true};
}

export function calibrateDecision(dataset,options={}){
  const config=configuration(dataset,options),all=closed(dataset.bars??[]),bars=all.slice(-config.maxHistory),n=bars.length,trainEnd=Math.floor(n*.5),calibrationEnd=Math.floor(n*.75),gap=config.horizonBars;
  const samples=classificationSamples(bars,config),train=samples.filter(r=>r.index<trainEnd&&r.labelEndIndex<trainEnd),calibration=samples.filter(r=>r.index>=trainEnd+gap&&r.labelEndIndex<calibrationEnd),test=samples.filter(r=>r.index>=calibrationEnd+gap);
  const trainingPoints=[];for(let i=59;i<trainEnd;i++){const point=featurePoint(bars,i);if(point)trainingPoints.push(point);}
  const interval=config.timeframe*60000,closeTime=index=>bars[index]?new Date(Date.parse(bars[index].time)+interval).toISOString():null;
  const router={trendThreshold:clip(quantile(trainingPoints.map(r=>r.trend),.5)??.8,.65,1.2),highVolatilityThreshold:quantile(trainingPoints.map(r=>r.atrFraction),.75),fittedThrough:closeTime(trainEnd-1)};
  const range=rows=>({from:rows[0]?.time??null,to:rows.at(-1)?.labelEndTime??null,sample:rows.length,classSamples:counts(rows)});
  const model={version,symbol:dataset.symbol??null,source:dataset.source??null,timeframe:config.timeframe,featureWindow,featureNames:[...featureNames],classes:[...classes],cost:config.cost,router,event:{kind:'market_class_probability',description:'Direction nette à '+(config.horizonBars*config.timeframe)+' min',horizonBars:config.horizonBars,horizonMinutes:config.horizonBars*config.timeframe,neutralAtr:config.neutralAtr,definition:'UP/DOWN si le rendement clôture à clôture dépasse ±('+config.neutralAtr+' ATR initial / cours initial + coûts aller-retour), sinon FLAT'},split:{fractions:[.5,.25,.25],gapBars:gap,train:{start:0,end:trainEnd},calibration:{start:trainEnd+gap,end:calibrationEnd},test:{start:calibrationEnd+gap,end:n},bars:n,discardedHistory:all.length-n},trainingRange:range(train),calibrationRange:range(calibration),testRange:range(test),trainedThrough:closeTime(trainEnd-1),calibratedThrough:closeTime(calibrationEnd-1),asOf:closeTime(n-1),status:'insufficient',reason:'Historique ou classes trop peu représentés',calibrated:false,audited:false,scaler:null,weights:null,temperature:null,classPrior:null,training:null,calibration:null,test:null};
  Object.assign(model,{algorithm:null,selection:null,neighbors:null,neighborCount:null,logisticTemperature:null,discriminant:null,neural:null,linearDiscriminant:null});
  const enough=train.length>=config.minTrainSamples&&calibration.length>=config.minCalibrationSamples&&classes.every(label=>counts(train)[label]>=config.minClassSamples&&counts(calibration)[label]>=config.minCalibrationClassSamples);
  if(!enough)return model;
  model.algorithm='multinomial-logistic';
  model.scaler=standardizer(train);model.weights=fitLogistic(train,model.scaler,config);model.classPrior=classes.map(label=>counts(train)[label]/train.length);
  let bestTemperature=1,bestLoss=diagnostics(calibration,model,1).logLoss;
  for(let i=0;i<=40;i++){const temperature=Math.exp(Math.log(.25)+i*Math.log(16)/40),loss=diagnostics(calibration,model,temperature).logLoss;if(loss<bestLoss){bestLoss=loss;bestTemperature=temperature;}}
  model.temperature=bestTemperature;model.logisticTemperature=bestTemperature;
  const logisticCalibration=diagnostics(calibration,model),candidates=[{algorithm:model.algorithm,k:null,shrinkage:null,hiddenUnits:null,temperature:bestTemperature,brier:logisticCalibration.brier,logLoss:logisticCalibration.logLoss,sample:calibration.length}];
  model.neighbors=fitNearestNeighbors(train,model.scaler,{k:31});
  let selected=candidates[0],selectedCalibration=logisticCalibration;
  if(model.neighbors){
    for(const k of [15,31,61]){
      if(train.length<=k)continue;
      const candidateModel={...model,algorithm:neighborAlgorithm,neighborCount:k,temperature:1},report=diagnostics(calibration,candidateModel),candidate={algorithm:neighborAlgorithm,k,shrinkage:null,hiddenUnits:null,temperature:1,brier:report.brier,logLoss:report.logLoss,sample:calibration.length};
      candidates.push(candidate);
      // Ties retain the simpler logistic model or the earlier smaller k.
      if(candidate.brier<selected.brier){selected=candidate;selectedCalibration=report;}
    }
  }
  for(const shrinkage of [.25,.5,.9]){
    // Covariances, means and priors are fitted exclusively on the training set.
    // Only shrinkage/temperature selection can consult the calibration set.
    const discriminant=fitRegularizedQDA(train,model.scaler,{shrinkage});if(!discriminant)continue;
    if(!model.discriminant)model.discriminant=discriminant;
    const candidateModel={...model,algorithm:qdaAlgorithm,discriminant,temperature:1};
    let temperature=1,loss=diagnostics(calibration,candidateModel,1).logLoss;
    for(let i=0;i<=40;i++){
      const next=Math.exp(Math.log(.25)+i*Math.log(16)/40),nextLoss=diagnostics(calibration,candidateModel,next).logLoss;
      if(nextLoss<loss){loss=nextLoss;temperature=next;}
    }
    const report=diagnostics(calibration,candidateModel,temperature),candidate={algorithm:qdaAlgorithm,k:null,shrinkage,hiddenUnits:null,temperature,brier:report.brier,logLoss:report.logLoss,sample:calibration.length};
    candidates.push(candidate);
    if(candidate.brier<selected.brier){selected=candidate;selectedCalibration=report;model.discriminant=discriminant;}
  }
  for(const hiddenUnits of [8,16]){
    // Both architectures use independent deterministic weights fitted on train
    // only. Epoch count is fixed in advance and never chosen on held-out data.
    const neural=fitNeuralNetwork(train,model.scaler,{hiddenUnits,iterations:Math.min(config.iterations,160),regularization:config.regularization});if(!neural)continue;
    if(!model.neural)model.neural=neural;
    const candidateModel={...model,algorithm:neuralAlgorithm,neural,temperature:1};
    let temperature=1,loss=diagnostics(calibration,candidateModel,1).logLoss;
    for(let i=0;i<=40;i++){
      const next=Math.exp(Math.log(.25)+i*Math.log(16)/40),nextLoss=diagnostics(calibration,candidateModel,next).logLoss;
      if(nextLoss<loss){loss=nextLoss;temperature=next;}
    }
    const report=diagnostics(calibration,candidateModel,temperature),candidate={algorithm:neuralAlgorithm,k:null,shrinkage:null,hiddenUnits,temperature,brier:report.brier,logLoss:report.logLoss,sample:calibration.length};
    candidates.push(candidate);
    if(candidate.brier<selected.brier){selected=candidate;selectedCalibration=report;model.neural=neural;}
  }
  let bestLdaBrier=Infinity;
  for(const shrinkage of [.25,.9]){
    const linearDiscriminant=fitRegularizedLDA(train,model.scaler,{shrinkage});if(!linearDiscriminant)continue;
    const candidateModel={...model,algorithm:ldaAlgorithm,linearDiscriminant,temperature:1};
    let temperature=1,loss=diagnostics(calibration,candidateModel,1).logLoss;
    for(let i=0;i<=40;i++){const next=Math.exp(Math.log(.25)+i*Math.log(16)/40),nextLoss=diagnostics(calibration,candidateModel,next).logLoss;if(nextLoss<loss){loss=nextLoss;temperature=next;}}
    const report=diagnostics(calibration,candidateModel,temperature),candidate={algorithm:ldaAlgorithm,k:null,shrinkage,hiddenUnits:null,temperature,brier:report.brier,logLoss:report.logLoss,sample:calibration.length};
    candidates.push(candidate);if(candidate.brier<bestLdaBrier){model.linearDiscriminant=linearDiscriminant;bestLdaBrier=candidate.brier;}
    if(candidate.brier<selected.brier){selected=candidate;selectedCalibration=report;}
  }
  model.algorithm=selected.algorithm;model.neighborCount=selected.k;model.temperature=selected.temperature;
  model.selection={metric:'brier',partition:'calibration',selected:selected.algorithm,selectedK:selected.k,selectedShrinkage:selected.shrinkage,selectedHiddenUnits:selected.hiddenUnits,trainingRefit:false,holdoutUsed:false,candidates};
  model.training=diagnostics(train,model,1,{excludeTrainingSelf:model.algorithm===neighborAlgorithm});model.training.predictionMode=model.algorithm===neighborAlgorithm?'leave-one-out':'resubstitution';
  model.calibration=selectedCalibration;model.test=diagnostics(test,model);
  model.test.robustness=auditProbabilityRows(test.map(row=>({...row,probabilities:probabilities(row.features,model)})),model.classPrior);
  model.training.labelCoverage=train.length/Math.max(1,trainEnd-gap-59);model.calibration.labelCoverage=calibration.length/Math.max(1,calibrationEnd-trainEnd-2*gap);model.test.labelCoverage=test.length/Math.max(1,n-calibrationEnd-2*gap);
  model.status='estimate';model.reason='Un seul classifieur sélectionné sur validation ; diagnostic final séparé des paramètres';model.calibrated=model.algorithm!==neighborAlgorithm;model.calibrationMethod=model.calibrated?'temperature-scaling':'neighbor-count-validation';model.audited=test.length>=config.minTestSamples;
  return model;
}

export function predictMarketClass(bars,model){
  const b=closed(bars),point=featurePoint(b,b.length-1),asOf=Date.parse(b.at(-1)?.time)+900000;
  if(!point||model?.version!==version||model.featureWindow!==featureWindow||model.status!=='estimate'||!Number.isFinite(model.temperature)||model.temperature<=0)return null;
  if(!Array.isArray(model.classes)||model.classes.join(',')!==classes.join(',')||!Number.isFinite(Date.parse(model.calibratedThrough)))return null;
  if(!Array.isArray(model.weights)||model.weights.length!==3||model.weights.some(row=>!Array.isArray(row)||row.length!==featureNames.length+1||row.some(x=>!Number.isFinite(x))))return null;
  if(!Array.isArray(model.scaler?.mean)||model.scaler.mean.length!==featureNames.length||model.scaler.mean.some(x=>!Number.isFinite(x))||!Array.isArray(model.scaler.scale)||model.scaler.scale.length!==featureNames.length||model.scaler.scale.some(x=>!Number.isFinite(x)||x<=0))return null;
  if(model.algorithm!==undefined&&!['multinomial-logistic',neighborAlgorithm,qdaAlgorithm,neuralAlgorithm,ldaAlgorithm].includes(model.algorithm))return null;
  if(model.algorithm===neighborAlgorithm&&!validNeighborModel({...model.neighbors,k:model.neighborCount??model.neighbors?.k},featureNames.length))return null;
  if(model.algorithm===qdaAlgorithm&&!validDiscriminantModel(model.discriminant,featureNames.length))return null;
  if(model.algorithm===ldaAlgorithm&&!validLinearDiscriminant(model.linearDiscriminant,featureNames.length))return null;
  if(model.algorithm===neuralAlgorithm&&!validNeuralModel(model.neural,featureNames.length))return null;
  if(Date.parse(model.calibratedThrough)>asOf)return null;
  const p=probabilities(point.features,model);if(!Array.isArray(p)||p.length!==3||p.some(value=>!Number.isFinite(value)||value<0||value>1)||Math.abs(p.reduce((a,b)=>a+b,0)-1)>1e-9)return null;
  return Object.fromEntries(classes.map((label,i)=>[label,p[i]]));
}

export function decide(bars,model=null,options={}){
  const b=closed(bars),route=routeStrategy(b,model?.version===version?model.router:null),raw=signal(b.slice(-featureWindow),route.strategy),h1=route.higherTimeframe,stale=options.fresh===false;
  const opposed=h1.available&&(raw.side==='BUY'&&h1.direction==='DOWN'||raw.side==='SELL'&&h1.direction==='UP');
  const classProbs=stale?null:predictMarketClass(b,model),candidateSide=['BUY','SELL'].includes(raw.side)?raw.side:null,candidateClass=candidateSide==='BUY'?'UP':candidateSide==='SELL'?'DOWN':null;
  const plan=candidateSide?executionPlan(raw,options.quote??null,options.cost??model?.cost??costForSymbol(options.symbol??model?.symbol)):null;
  const invalidStructuralPlan=plan?.invalidStructure??false,filteredByLevels=plan?.filteredByLevels??false,filteredByPrice=plan?.filteredByPrice??false,filteredByCosts=plan?.filteredByCosts??false;
  // Compare the published tenth-percent value, so BUY/SELL can never display 60.0%.
  const candidatePercent=candidateClass&&Number.isFinite(classProbs?.[candidateClass])?Math.round(classProbs[candidateClass]*1000)/10:null,
    gatePassed=candidatePercent!==null&&candidatePercent>signalPolicy.minimumPercent,
    filteredByConfidence=Boolean(candidateSide&&!stale&&!opposed&&!filteredByLevels&&!filteredByPrice&&!filteredByCosts&&!gatePassed),
    side=stale||opposed||filteredByLevels||filteredByPrice||filteredByCosts||filteredByConfidence?'HOLD':raw.side,
    reason=stale?'Cours indisponibles ou périmés':filteredByLevels||filteredByPrice||filteredByCosts?plan.reason:opposed?'Filtre H1 opposé au signal '+raw.side:filteredByConfidence?
      candidatePercent===null?'Confiance '+candidateSide+' indisponible · seuil > 60 %':'Confiance '+candidateSide+' '+candidatePercent.toFixed(1).replace('.',',')+' % · seuil > 60 %':raw.reason,
    selectedClass=side==='BUY'?'UP':side==='SELL'?'DOWN':'FLAT';
  const futureModel=Date.parse(model?.calibratedThrough)>Date.parse(b.at(-1)?.time)+900000;
  const referenceMs=Date.parse(b.at(-1)?.time)+900000,horizonMinutes=model?.event?.horizonMinutes??60,
    referenceTime=Number.isFinite(referenceMs)?new Date(referenceMs).toISOString():null,
    referencePrice=Number.isFinite(b.at(-1)?.close)?b.at(-1).close:null,
    horizonEndAt=Number.isFinite(referenceMs)&&Number.isFinite(horizonMinutes)?new Date(referenceMs+horizonMinutes*60000).toISOString():null;
  const neighborDetail=classProbs&&model.algorithm===neighborAlgorithm?neighborPrediction(featurePoint(b,b.length-1).features,model):null;
  const confidence={percent:classProbs?Math.round(classProbs[selectedClass]*1000)/10:null,kind:'market_class_probability',event:model?.event?.description??'Direction nette à 60 min',horizonBars:model?.event?.horizonBars??4,horizonMinutes,referenceTime,referencePrice,horizonEndAt,cost:model?.cost??null,class:selectedClass,classProbs,algorithm:classProbs?(model.algorithm??'multinomial-logistic'):null,neighboursCount:neighborDetail?.neighborsCount??0,neighboursEffectiveSample:neighborDetail?.effectiveNeighbors??null,neighboursDetail:neighborDetail?.detail??[],sample:model?.trainingRange?.sample??0,calibrationSample:model?.calibrationRange?.sample??0,testSample:model?.testRange?.sample??0,classSamples:model?.trainingRange?.classSamples??null,calibrated:Boolean(classProbs&&model?.calibrated),audited:Boolean(classProbs&&model?.audited),status:stale?'stale':classProbs?'estimate':'insufficient',reason:stale?reason:classProbs?'Probabilité du mouvement net à 1 h ; distincte du taux de trades gagnants':futureModel?'Modèle postérieur à cette bougie':model?.reason??'Modèle historique en préparation',trainingRange:model?.trainingRange??null};
  return {...raw,side,reason,riskDistance:side==='HOLD'?raw.riskDistance:plan.riskDistance,entry:side==='HOLD'?null:plan.entry,stop:side==='HOLD'?null:raw.stop,target:side==='HOLD'?null:raw.target,
    invalidation:invalidStructuralPlan?null:raw.invalidation,
    setup:raw.setup?{...raw.setup,confirmed:side!=='HOLD',entry:side==='HOLD'?null:plan.entry,...(invalidStructuralPlan?{stop:null,target:null,invalidation:null}:{})}:undefined,
    route,executionPlan:plan,confidence,confidenceGate:{...signalPolicy,candidateSide,candidateClass,candidatePercent,passed:gatePassed},filteredByConfidence,filteredByH1:opposed,filteredByFreshness:stale,filteredByLevels,filteredByPrice,filteredByCosts,dataMode:options.dataMode??null,closed:true};
}
