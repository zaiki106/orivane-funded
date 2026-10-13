import {exitQuotePrice} from './core/execution-plan.mjs';
import {mergeHistory,readHistory,saveHistory} from './core/history-store.mjs';
import {validateBars,strategies,sizePosition,signal,indicators,analysisWindow} from './core/engine.mjs';
import {decide,signalPolicy} from './core/decision.mjs';
import {applyModelAssessment} from './core/model-assessment.mjs';
import {costForSymbol,roundTripFee} from './core/cost-policy.mjs';
import {decisionDiagnostics} from './core/decision-diagnostics.mjs';
import {marketHealth} from './core/market-health.mjs';
import {buildIdeaSetups,rankIdeas,explainHold} from './core/ideas.mjs';
import {strategyEvidence} from './core/strategy-evidence.mjs';
import {KrakenLiveFeed} from './core/live-feed.mjs';
import {DerivLiveFeed,DERIV_SOURCE} from './core/deriv-feed.mjs';
import {defaultProfile,validateProfile,marketSymbols} from './core/profile.mjs';
globalThis.process={env:{ORIVANE_COST_PROFILE:'the5ers'}};
const datasets=new Map(),models=new Map(),labs=new Map(),replays=new Map(),jobs=new Map(),queue=new Set(),observed=new Map();let fitting=false,started=false,profile={...defaultProfile},positions=[],history=[],followups=[],daily={},news={status:'loading',items:[],sources:[]};
const iso=()=>new Date().toISOString(),token=crypto.randomUUID();
const timers={setTimer:(f,d)=>setTimeout(f,d),clearTimer:id=>clearTimeout(id),setRepeater:(f,d)=>setInterval(f,d),clearRepeater:id=>clearInterval(id)};
const kraken=new KrakenLiveFeed({...timers,symbols:['BTC/USD'],onUpdate:update,onClosedBar:closeBar});
const deriv=new DerivLiveFeed({...timers,onHistory:install,onUpdate:update,onClosedBar:closeBar});
function save(){postMessage({type:'saved',value:{profile,positions,history,followups,daily}});}
function update(u){const d=datasets.get(u.symbol);if(!d)return;if(u.quote)d.quote=u.quote;if(u.currentBar)d.currentBar=u.currentBar;}
function closeBar(symbol,bar){const d=datasets.get(symbol);if(d)install({...d,bars:[...d.bars,bar]});}
function install(value){
 const prior=datasets.get(value.symbol),incoming={...value,timeframe:value.timeframe??15,bars:validateBars(value.bars).filter(b=>b.closed!==false)},bars=mergeHistory(prior,incoming),fingerprint=JSON.stringify(bars),changed=!prior||prior.fingerprint!==fingerprint;
 const context=changed?indicators(bars.slice(-analysisWindow)):null,closedSignals=changed?strategies.map(rule=>signal(bars.slice(-analysisWindow),rule.id,context)):prior.closedSignals;
 datasets.set(value.symbol,{...prior,...value,timeframe:15,bars,fingerprint,closedSignals});if(changed){saveHistory(datasets.get(value.symbol));jobs.set(value.symbol,{status:'pending',version:(jobs.get(value.symbol)?.version??0)+1});queue.add(value.symbol);setTimeout(fitNext,0);}emit();
}
function fitNext(){if(fitting||!queue.size)return;fitting=true;const symbol=queue.values().next().value;queue.delete(symbol);postMessage({type:'model-request',symbol,version:jobs.get(symbol).version,dataset:datasets.get(symbol)});}
function modelReply(m){
 const currentVersion=jobs.get(m.symbol)?.version;
 // Results for revised candles cannot validate the current dataset.
 if(m.version===currentVersion){
  if(m.type==='model-fit'){models.set(m.symbol,m.model);jobs.set(m.symbol,{...jobs.get(m.symbol),status:'ready',trainedAt:iso()});}
  if(m.type==='model-complete'){if(m.lab)labs.set(m.symbol,m.lab);if(m.replay)replays.set(m.symbol,m.replay);}
  if(m.type==='model-error')jobs.set(m.symbol,{...jobs.get(m.symbol),status:'error'});
 }
 if(m.type==='model-complete'||m.type==='model-error'){fitting=false;fitNext();}emit();
}
function feed(d){return d?.source==='Kraken public · spot'?kraken.snapshot(d.symbol):d?.source===DERIV_SOURCE?deriv.snapshot(d.symbol):{status:d?.provenance?.marketOpen===false?'closed':'snapshot',ageMs:d?.quote?Date.now()-Date.parse(d.quote.receivedAt):null};}
function recent(d){const age=Date.now()-Date.parse(d?.quote?.receivedAt),barAge=Date.now()-Date.parse(d?.bars.at(-1)?.time)-900000,f=feed(d);return d?.provenance?.marketOpen!==false&&age>=-60000&&age<(d?.quote?.transport==='websocket'?30000:120000)&&barAge>=0&&barAge<900000&&(d?.symbol==='NDX'||f.status==='live');}
function current(symbol){const d=datasets.get(symbol),m=models.get(symbol),f=feed(d),fresh=recent(d),mode=d?.symbol==='NDX'?'snapshot':fresh?'live':'historical';
 let result=decide(d?.bars??[],m,{fresh,dataMode:mode,quote:d?.quote,symbol,cost:costForSymbol(symbol)});
 if(!fresh)result={...result,side:'HOLD',reason:f.status==='closed'?'Marché fermé':'Données historiques ou périmées',confidence:{...result.confidence,percent:null,classProbs:null,status:'stale'}};
 else if(jobs.get(symbol)?.status!=='ready')result={...result,side:'HOLD',reason:'Calibration en cours',entry:null,stop:null,target:null,confidence:{...result.confidence,percent:null,classProbs:null,status:'pending'}};
 else result=applyModelAssessment(result,m);
 return result;
}
function rows(){return marketSymbols.map(symbol=>{
 const d=datasets.get(symbol),decision=current(symbol),f=feed(d),job=jobs.get(symbol)??{status:'pending',version:0},live=symbol!=='NDX'&&recent(d),source=d?.source??null;
 const row={symbol,source,timeframe:15,asOf:d?.bars.at(-1)?.time??null,bars:d?.bars.slice(-85)??[],quote:d?.quote??null,currentBar:d?.currentBar??f.currentBar??null,live,provenance:d?.provenance??{},quality:d?.quality??{},feed:{...f,status:d?f.status:'unavailable'},model:job,decision,signal:decision,eligible:profile.allowedSymbols.includes(symbol),signals:d?.closedSignals??[],previewSignals:[],coverage:d?.bars.length??0,execution:live?'Paper sur cet appareil':'Non exécutable'};
 row.research=labs.get(symbol)?.datasetVersion===job.version?labs.get(symbol).research:null;row.decisionChecks=decisionDiagnostics(row);row.strategyEvidence=strategyEvidence(labs.get(symbol),decision.strategy);row.replay=replays.get(symbol)??null;
 row.ideas=d?.bars.length>=60?rankIdeas(buildIdeaSetups(d),{quote:d.quote,decision,live,isFresh:recent(d)}):[];
 row.holdReason=explainHold(d,decision,{isFresh:recent(d)});return row;
});}
function equity(){const realized=positions.filter(p=>p.status==='closed').reduce((s,p)=>s+p.pnl,0),floating=positions.filter(p=>p.status==='open').reduce((s,p)=>{const px=exitQuotePrice(datasets.get(p.symbol)?.quote,p.side)??p.entry,dir=p.side==='BUY'?1:-1;return s+dir*(px-p.entry)*p.quantity-roundTripFee(p.cost,p.entry,px)*p.quantity;},0),value=profile.capital+realized+floating,day=new Intl.DateTimeFormat('en-CA',{timeZone:profile.resetTimezone}).format(new Date());if(daily[day]===undefined){daily[day]=value;save();}
 const dayLoss=Math.max(0,daily[day]-value),totalLoss=Math.max(0,profile.capital-value),openRisk=positions.filter(p=>p.status==='open').reduce((s,p)=>s+p.netRisk*p.quantity,0);
 return {capital:profile.capital,equity:value,realized,floating,dayLoss,totalLoss,openRisk,target:profile.capital*profile.targetPercent/100,remaining:Math.max(0,profile.capital*(1+profile.targetPercent/100)-value),tradingDays:new Set(positions.map(p=>p.openedAt.slice(0,10))).size,breached:dayLoss>=profile.capital*profile.dailyLossPercent/100||totalLoss>=profile.capital*profile.totalLossPercent/100};
}
function finish(p,reason){const d=datasets.get(p.symbol);if(!recent(d)||d.source!==p.source)throw Error('Cotation actuelle indisponible');const dir=p.side==='BUY'?1:-1,px=dir===1?(d.quote.bid??d.quote.price):(d.quote.ask??d.quote.price),exit=px*(1-dir*p.cost.slippageBps/10000);Object.assign(p,{status:'closed',exit,pnl:(dir*(exit-p.entry)-roundTripFee(p.cost,p.entry,exit))*p.quantity,reason,closedAt:iso()});save();}
function observe(radar){for(const row of radar){if(!row.live)continue;const d=row.decision,price=row.quote.price;
 for(const p of positions.filter(p=>p.symbol===row.symbol&&p.status==='open'&&p.source===row.source)){const exitPrice=exitQuotePrice(row.quote,p.side);if(exitPrice===null)continue;const stop=p.side==='BUY'?exitPrice<=p.stop:exitPrice>=p.stop,target=p.side==='BUY'?exitPrice>=p.target:exitPrice<=p.target;if(stop||target)finish(p,stop?'Stop observé':'Objectif observé');}
 for(const f of followups.filter(f=>f.symbol===row.symbol&&f.source===row.source&&f.status==='watching')){if(Date.now()>Date.parse(f.horizonEndAt)){f.status='expired';save();continue;}const exitPrice=exitQuotePrice(row.quote,f.side);if(exitPrice===null)continue;const stop=f.side==='BUY'?exitPrice<=f.stop:exitPrice>=f.stop,target=f.side==='BUY'?exitPrice>=f.target:exitPrice<=f.target;if(stop||target){Object.assign(f,{status:stop?'stop-observed':'target-observed',observedPrice:exitPrice,observedAt:row.quote.receivedAt});save();}}
 const key=[row.source,d.time,d.strategy,d.side].join('|');if(observed.get(row.symbol)===key)continue;observed.set(row.symbol,key);
 if(!['BUY','SELL'].includes(d.side)||!d.confidenceGate.passed||d.confidence.percent<=60||!d.modelAssessment?.passed)continue;
 const event={id:crypto.randomUUID(),type:'signal',mode:'observed-live',policy:signalPolicy.id,symbol:row.symbol,source:row.source,strategy:d.strategy,strategyName:d.strategyName,side:d.side,entry:d.entry,stop:d.stop,target:d.target,confidencePercent:d.confidence.percent,confidenceClass:d.confidence.class,signalTime:d.time,referenceTime:d.confidence.referenceTime,horizonEndAt:d.confidence.horizonEndAt,observedAt:iso()};history.unshift(event);history=history.slice(0,500);followups.unshift({...event,status:'watching',signalObservedAt:event.observedAt});followups=followups.slice(0,500);save();}}
function snapshot(){const radar=rows();observe(radar);return {token,profile,account:equity(),positions,radar,marketHealth:radar.map(m=>marketHealth(m)),signalPolicy,strategyCatalog:strategies,signalHistory:{mode:'observed-live',items:history},signalFollowup:{mode:'observed-levels',items:followups},news,sources:[],modelJobs:{active:fitting?1:0,queued:queue.size,concurrency:1}};}
function emit(){if(started)postMessage({type:'state',state:snapshot()});}
async function getJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Fournisseur indisponible');return r.json();}
async function btcHistory(){try{const o=await getJSON('/cloud/kraken');if(o.ohlc.error?.length||o.ticker.error?.length)throw Error();const key=Object.keys(o.ohlc.result).find(k=>k!=='last'),rows=o.ohlc.result[key],t=o.ticker.result[Object.keys(o.ticker.result)[0]],at=o.receivedAt;const bars=rows.map(r=>({time:new Date(r[0]*1000).toISOString(),open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[6],trades:+r[7]}));const value={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,bars:bars.slice(0,-1),currentBar:{...bars.at(-1),closed:false},quote:{price:+t.c[0],bid:+t.b[0],ask:+t.a[0],receivedAt:at,transport:'rest'}};const prior=datasets.get('BTC/USD');if(prior?.quote?.transport==='websocket')value.quote=prior.quote;install(value);kraken.seed('BTC/USD',value);}catch{}}
async function nasdaq(){try{install(await getJSON('/cloud/nasdaq'));}catch{}}
async function readNews(){try{const n=await getJSON('/cloud/news');news={...n,status:n.sources?.some(s=>s.status==='ok')?'ready':'unavailable',updatedAt:n.receivedAt};emit();}catch{news={status:'unavailable',items:[],sources:[]};}}
function publicModels(symbol){return {markets:marketSymbols.filter(s=>!symbol||s===symbol).map(s=>{const m=models.get(s)??{};return {symbol:s,source:datasets.get(s)?.source,version:jobs.get(s)?.version,status:jobs.get(s)?.status,algorithm:m.algorithm,selection:m.selection,test:m.test,training:m.training,calibration:m.calibration,cost:m.cost};})};}
async function api(url,value){const u=new URL(url,'https://device.invalid');if(u.pathname==='/api/state')return snapshot();if(u.pathname==='/api/model')return publicModels(u.searchParams.get('symbol'));if(u.pathname==='/api/export')return {profile,positions,history};
 if(u.pathname==='/api/profile'){const p=validateProfile(value);if(positions.length&&(p.capital!==profile.capital||p.resetTimezone!==profile.resetTimezone))throw Error('Capital et fuseau verrouillés après le premier trade');profile=p;save();emit();return profile;}
 if(u.pathname==='/api/paper/close'){const p=positions.find(p=>p.id===value.id&&p.status==='open');if(!p)throw Error('Position absente');finish(p,'Clôture manuelle paper');emit();return p;}
 if(u.pathname==='/api/paper/open'){const symbol=value.symbol,d=datasets.get(symbol),s=current(symbol),ac=equity();if(!profile.confirmed||!profile.allowedSymbols.includes(symbol)||!recent(d)||symbol==='NDX'||d?.source==null)throw Error('Profil ou cotation non exécutable');if(ac.breached)throw Error('Limite de perte atteinte');if(s.side==='HOLD'||!s.modelAssessment?.passed||!s.confidenceGate?.passed||s.confidence.percent<=60||s.strategy!==value.strategy||!s.executionPlan?.valid)throw Error('Signal confirmé > 60 % requis');if(positions.some(p=>p.symbol===symbol&&p.status==='open'))throw Error('Position déjà ouverte');const plan=s.executionPlan,cost=costForSymbol(symbol),sized=sizePosition({capital:Math.min(ac.equity,profile.capital),riskPercent:profile.riskPercent,entry:plan.entry,stop:plan.stop,unitRisk:plan.netRisk});if(ac.openRisk+plan.netRisk*sized.quantity>profile.capital*profile.openRiskPercent/100)throw Error('Risque ouvert dépassé');if(positions.filter(p=>p.status==='open').reduce((sum,p)=>sum+p.entry*p.quantity,0)+sized.notional>ac.equity)throw Error('Exposition supérieure au capital');const p={id:crypto.randomUUID(),symbol,source:d.source,strategy:s.strategy,side:s.side,entry:plan.entry,stop:plan.stop,target:plan.target,netRisk:plan.netRisk,...sized,cost,status:'open',openedAt:iso(),mode:'paper-device'};positions.unshift(p);save();emit();return p;}
 throw Error('Route inconnue');}
self.onmessage=async({data:m})=>{if(['model-fit','model-complete','model-error'].includes(m.type)){modelReply(m);return;}if(m.type==='init'&&!started){try{if(m.saved?.profile)profile=validateProfile(m.saved.profile);if(Array.isArray(m.saved?.positions))positions=m.saved.positions;if(Array.isArray(m.saved?.history))history=m.saved.history;if(Array.isArray(m.saved?.followups))followups=m.saved.followups;if(m.saved?.daily)daily=m.saved.daily;}catch{}started=true;for(const cached of await readHistory()){const expected=cached.symbol==='BTC/USD'?'Kraken public · spot':cached.symbol==='NDX'?'Yahoo Finance · Nasdaq-100 index':DERIV_SOURCE;if(marketSymbols.includes(cached.symbol)&&cached.source===expected&&cached.timeframe===15){try{install({...cached,quote:null,currentBar:null,live:false});}catch{}}}kraken.start();deriv.start();btcHistory();nasdaq();readNews();emit();setInterval(emit,1000);setInterval(btcHistory,60000);setInterval(nasdaq,60000);setInterval(readNews,300000);}if(m.type==='api'){try{postMessage({type:'reply',id:m.id,value:await api(m.url,m.value)});}catch(e){postMessage({type:'reply',id:m.id,error:e.message});}}};
