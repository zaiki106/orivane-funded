import {strategies} from './engine.mjs';
import {tradeEntryPolicy,tradeMaxEntryDelayMs} from './trade-outcome.mjs';

export const strategyRegistryVersion='orivane-strategy-registry-v1';
export const strategyFamilies=Object.freeze(['trend','breakout','reversion','price-structure','volatility','session','multi-timeframe','economic-event','microstructure','cross-market']);
const reversion=new Set(['regression-reentry','cmo-recovery','stc-recovery','dpo-recovery','mass-reversal','mfi-recovery','reversion','rsi-recovery','stochastic','keltner-reentry','cci-recovery','williams-recovery','fisher-recovery','ultimate-recovery','smi','stoch-rsi','demarker']);
const structures=new Set(['breakout-retest','two-bar-pullback','fractal-breakout','failed-breakout','engulfing-reclaim','inside-bar','liquidity-sweep']);
const breakouts=new Set(['breakout','donchian55','chop-breakout','vhf-breakout','cmf-breakout','adl-breakout']);
const volume=new Set(['vwap','cmf-breakout','force-cross','eom-cross','nvi-reclaim','vpt-cross','adl-breakout','mfi-recovery']);
const structuralStops=new Set(['breakout-retest','two-bar-pullback','fractal-breakout','failed-breakout','nr7-breakout','engulfing-reclaim','supertrend','stochastic','keltner-reentry','inside-bar','liquidity-sweep','continuation','ichimoku','cci-recovery','williams-recovery','fisher-recovery','dema-reclaim','kama-reclaim','ultimate-recovery','smi','stoch-rsi','elder-ray','demarker','parabolic-sar','chandelier']);
const lowReward=new Set(['dpo-recovery','mass-reversal','mfi-recovery','reversion','rsi-recovery','stochastic','keltner-reentry','cci-recovery','williams-recovery','fisher-recovery','ultimate-recovery','smi','stoch-rsi','demarker']);
const formula={
 'alma-reclaim':['ALMA(21,6,0.85)','EMA(50)'],'hma-reclaim':['HMA(21)','EMA(50)'],'regression-trend':['OLS(20)','EMA(50)'],'regression-reentry':['OLS-residual(20)'],
 'efficiency-trend':['EfficiencyRatio(10)','EMA(21,50)'],'chop-breakout':['Choppiness(14)','Donchian(20)','EMA(50)'],'cmo-recovery':['CMO(14)'],
 'coppock-cross':['ROC(11,14)','WMA(10)','EMA(50)'],'kst-cross':['ROC(10,15,20,30)','SMA(10,10,10,15)','KST-SMA(9)','EMA(50)'],'cmf-breakout':['CMF(20)','EMA(50)'],
 'utc-opening-range':['UTC-opening-range(00:00-01:00)','EMA(50)'],'previous-day-breakout':['UTC-previous-day(96-bars)','EMA(50)'],
 'tema-reclaim':['TEMA(21)','EMA(50)'],'zlema-reclaim':['ZLEMA(21)','EMA(50)'],'vhf-breakout':['VHF(28)','Donchian(20)','EMA(50)'],
 'stc-recovery':['MACD(23,50)','double-stochastic(10)','EMA(3,50)'],'dpo-recovery':['causal-DPO(20,lag11)'],'mass-reversal':['MassIndex(9,9,25)'],
 'force-cross':['ForceIndex-EMA(13)','EMA(50)'],'eom-cross':['EOM-SMA(14)','EMA(50)'],'nvi-reclaim':['NVI','EMA(21,50)'],'vpt-cross':['VPT','EMA(21,50)'],
 'adl-breakout':['ADL','Donchian-ADL(20)','EMA(50)'],'mfi-recovery':['MFI(14)'],
 'breakout-retest':['Donchian(20)','EMA(21,50)'],'two-bar-pullback':['EMA(21,50)','two-closed-bar-reclaim'],'fractal-breakout':['confirmed-fractal(5)','EMA(21,50)'],
 'failed-breakout':['Donchian(20)'],'nr7-breakout':['NR7','EMA(21,50)'],'engulfing-reclaim':['engulfing-body','EMA(21,50)'],
 pullback:['EMA(9,21,50)','RSI-Wilder(14)'],breakout:['Donchian(20)','EMA(21)','volume-ratio(20)'],reversion:['Bollinger(20,2)'],
 'ema-cross':['EMA(9,21,50)'],macd:['MACD(12,26,9)','EMA(50)'],'rsi-recovery':['RSI-Wilder(14)'],squeeze:['Bollinger(20,2)','bandwidth-quantile(40)','volume-ratio(20)'],
 vwap:['rolling-VWAP(20)'],supertrend:['Supertrend-Wilder(10,3)'],stochastic:['stochastic(14,3)'],'inside-bar':['strict-inside-bar(3)'],
 'liquidity-sweep':['Donchian(20)','rejection-wick'],continuation:['EMA(9,21,50)'],'keltner-reentry':['EMA(20)','Keltner-ATR(14,2)'],
 'adx-continuation':['ADX-Wilder(14)','DI(14)','EMA(50)'],ichimoku:['Ichimoku(9,26,52,displacement26)'],'cci-recovery':['CCI(20,.015)'],aroon:['Aroon(25)','EMA(50)'],
 donchian55:['Donchian(55)','EMA(50)'],'roc-momentum':['ROC(12)','EMA(50)'],'parabolic-sar':['SAR(.02,.02,.2)','EMA(21)'],
 'williams-recovery':['WilliamsR(14)'],'fisher-recovery':['Fisher-HL2(10,.33,.5)'],trix:['TRIX(15)','EMA(9,50)'],tsi:['TSI(25,13,7)','EMA(50)'],
 'dema-reclaim':['DEMA(21)','EMA(50)'],chandelier:['Chandelier(22,3)','ATR-Wilder(22)'],vortex:['Vortex(14)','EMA(50)'],
 'kama-reclaim':['KAMA(10,2,30)','EMA(50)'],ppo:['PPO(12,26,9)','EMA(50)'],'ultimate-recovery':['Ultimate(7,14,28,4:2:1)'],
 smi:['SMI(5,3,3,3)'],'stoch-rsi':['RSI-Wilder(14)','stochastic-RSI(14,3,3)'],'elder-ray':['EMA(13)','BullsPower','BearsPower'],
 demarker:['DeMarker(14)'],awesome:['Awesome-HL2-SMA(5,34)','EMA(50)']
};
function family(id){return ['utc-opening-range','previous-day-breakout'].includes(id)?'session':['squeeze','nr7-breakout'].includes(id)?'volatility':id==='ichimoku'?'multi-timeframe':structures.has(id)?'price-structure':reversion.has(id)?'reversion':breakouts.has(id)?'breakout':'trend';}
function origin(id){return ['tema-reclaim','zlema-reclaim','vhf-breakout','stc-recovery','dpo-recovery','mass-reversal','force-cross','eom-cross','nvi-reclaim','vpt-cross','adl-breakout','mfi-recovery'].includes(id)?'expansion-strategies.mjs':['alma-reclaim','hma-reclaim','regression-trend','regression-reentry','efficiency-trend','chop-breakout','cmo-recovery','coppock-cross','kst-cross','cmf-breakout','utc-opening-range','previous-day-breakout'].includes(id)?'advanced-strategies.mjs':structures.has(id)&&id!=='inside-bar'&&id!=='liquidity-sweep'?'price-patterns.mjs':'engine.mjs';}
export const strategyRegistry=Object.freeze(strategies.map((rule,index)=>Object.freeze({
 id:rule.id,name:rule.name,version:strategyRegistryVersion,order:index,family:family(rule.id),status:'research',
 instruments:Object.freeze(['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX']),
 data:Object.freeze({timeframeMinutes:15,closedCandles:true,ohlc:true,volume:volume.has(rule.id)?'required':'optional',barrierTicks:'optional',quote:'bid-ask-preferred',continuousHistory:true}),
 warmupBars:rule.id==='ichimoku'?78:rule.id==='previous-day-breakout'?160:60,
 indicators:Object.freeze(['ATR-Wilder(14)',...(formula[rule.id]??[])]),
 conditions:rule.description,implementation:Object.freeze({module:origin(rule.id),export:'signal',strategy:rule.id}),
 entry:'next-executable-quote-after-closed-setup',stop:structuralStops.has(rule.id)?'causal-structure-with-atr-fallback':'atr',
 entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,
 parameters:Object.freeze({atrPeriod:14,atrStop:rule.id==='donchian55'?2:1.4,targetR:rule.id==='donchian55'?2:lowReward.has(rule.id)?1.3:1.8,expiryBars:16}),
 h1Policy:'align-if-available',h1ResearchVariants:Object.freeze(['align-if-available','context-only']),
 provenance:Object.freeze({kind:'original-implementation-of-public-formulas',notice:'THIRD_PARTY_NOTICES.md',marketTimeframeAdaptation:'15m',sourceModule:origin(rule.id)}),
 validation:null
})));
const byId=new Map(strategyRegistry.map(rule=>[rule.id,rule]));
export function getStrategy(id){return byId.get(id)??null;}
export function registrySummary(){return {version:strategyRegistryVersion,total:strategyRegistry.length,families:strategyFamilies.map(id=>({id,rules:strategyRegistry.filter(rule=>rule.family===id).length,status:strategyRegistry.some(rule=>rule.family===id)?'implemented-research':'data-required'}))};}
export function strategyDataReady(rule,bars){
 if(!rule||!Array.isArray(bars)||bars.length<rule.warmupBars)return {ready:false,reason:'insufficient-history'};
 const recent=bars.slice(-rule.warmupBars);
 if(recent.some((bar,i)=>bar.closed===false||!Number.isFinite(Date.parse(bar.time))||![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high)||i&&Date.parse(bar.time)-Date.parse(recent[i-1].time)!==900000))return {ready:false,reason:'non-contiguous-history'};
 if(rule.data.volume==='required'&&bars.slice(-Math.min(60,bars.length)).some(bar=>!Number.isFinite(bar.volume)||bar.volume<=0||bar.volumeUnavailable))return {ready:false,reason:'real-volume-required'};
 return {ready:true,reason:null};
}
