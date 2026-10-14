import {researchCandidates,researchCandidateVersion} from './core/research-candidates.mjs';
import {selectKrakenQuote,restQuoteState} from './core/quote-selection.mjs';
import {KrakenBookFeed} from './core/kraken-book.mjs';
import {MarketTelemetry} from './core/market-telemetry.mjs';
import {validatePrivateImport} from './core/private-state.mjs';
import {cacheUsable} from './core/history-store.mjs';
import {liveTradeCandidate} from './core/trade-confidence.mjs';
import {strategyRegistry,strategyRegistryVersion} from './core/strategy-registry.mjs';
import {observeTradeOutcome} from './core/trade-outcome.mjs';
import {paperQuoteUpdates} from './core/paper-observer.mjs';
import {exitQuotePrice} from './core/execution-plan.mjs';
import {mergeHistory,readHistory,saveHistory} from './core/history-store.mjs';
import {validateBars,strategies,sizePosition,signal,indicators,analysisWindow} from './core/engine.mjs';
import {decide} from './core/decision.mjs';
import {tradeSignalPolicy as signalPolicy} from './core/trade-inference.mjs';
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
const bookFeed=new KrakenBookFeed({...timers,onUpdate:()=>observeDirect('BTC/USD')}),telemetry=new Map();
let restoreBlocked=false;let platform={version:'wallstreet12',lab:{status:'local-offline',description:'Laboratoire sur le PC'},corpus:{verifiedBytes:0,verifiedParts:0,totalBytes:28516267234}},publishedModels=new Map(),researchAudits=new Map();
async function loadPlatform(){try{const r=await fetch('/platform.json',{cache:'no-store'});if(r.ok){const p=await r.json();if(p.version==='wallstreet12')platform={...p,...(platform.privateRestore?{privateRestore:platform.privateRestore}:{})};}}catch{}}
async function loadPublishedModels(){try{const index=await getJSON('/models/index.json');if(index.schemaVersion!==1||!Array.isArray(index.models))return;
 for(const item of index.models){if(!marketSymbols.includes(item.symbol)||typeof item.url!=='string'||!/^\/models\/[a-zA-Z0-9._-]+\.json$/.test(item.url)||!/^[a-f0-9]{64}$/.test(item.sha256))continue;
  const response=await fetch(item.url,{cache:'no-store'});if(!response.ok)continue;const bytes=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==item.sha256)continue;
  const model=JSON.parse(new TextDecoder().decode(bytes));if(model.symbol===item.symbol&&model.kind==='tp_before_sl_probability'){
   publishedModels.set(item.symbol,model);
   if(typeof item.auditUrl==='string'&&/^\/reports\/[a-zA-Z0-9_]+\.json$/.test(item.auditUrl)&&/^[a-f0-9]{64}$/.test(item.auditSha256))try{
    const auditResponse=await fetch(item.auditUrl,{cache:'no-store'});if(!auditResponse.ok)continue;
    const auditBytes=await auditResponse.arrayBuffer(),auditDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',auditBytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(auditDigest!==item.auditSha256)continue;
    const audit=JSON.parse(new TextDecoder().decode(auditBytes));if(audit.id===model.id&&audit.metadata?.symbol===model.symbol&&audit.modelSha256===digest&&audit.inputSha256===item.inputSha256)researchAudits.set(model.symbol,audit);
   }catch{}
  }
 }}catch{}emit();}
function save(){if(restoreBlocked)return;postMessage({type:'saved',value:{profile,positions,history,followups,daily}});}
function update(u){const d=datasets.get(u.symbol);if(!d)return;if(u.quote){d.quote=u.quote;observeDirect(u.symbol);if(u.quote.eventTime){if(!telemetry.has(u.symbol))telemetry.set(u.symbol,new MarketTelemetry());telemetry.get(u.symbol).observe(u.quote.eventTime,u.quote.localReceivedAt??Date.now());}}if(u.currentBar)d.currentBar=u.currentBar;}
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
function feed(d){const b=d?.symbol==='BTC/USD'?bookFeed.snapshot():null;if(b?.checksumValid&&b.eventTime&&Date.now()-Date.parse(b.eventTime)>=0&&Date.now()-Date.parse(b.eventTime)<30000)return {...kraken.snapshot('BTC/USD'),status:'live',quote:executionQuote('BTC/USD',d.quote),ageMs:Date.now()-Date.parse(b.eventTime),dataBasis:'checksum-verified-book'};if(d?.source==='Kraken public · spot'&&d?.quote?.transport==='rest')return {...kraken.snapshot(d.symbol),status:restQuoteState(d.quote),ageMs:Date.now()-Date.parse(d.quote.receivedAt),quote:d.quote,transport:'rest'};return d?.source==='Kraken public · spot'?kraken.snapshot(d.symbol):d?.source===DERIV_SOURCE?deriv.snapshot(d.symbol):{status:d?.provenance?.marketOpen===false?'closed':'snapshot',ageMs:d?.quote?Date.now()-Date.parse(d.quote.receivedAt):null};}
function recent(d){const q=d?.quote?executionQuote(d.symbol,d.quote):null,age=Date.now()-Date.parse(q?.receivedAt),barAge=Date.now()-Date.parse(d?.bars.at(-1)?.time)-900000,f=feed(d);return cacheUsable(d)&&d?.provenance?.marketOpen!==false&&age>=-60000&&age<(d?.quote?.transport==='websocket'?30000:120000)&&barAge>=0&&barAge<900000&&(d?.symbol==='NDX'||f.status==='live');}
function current(symbol){const d=datasets.get(symbol),m=models.get(symbol),f=feed(d),fresh=recent(d),mode=d?.symbol==='NDX'?'snapshot':fresh?'live':'historical';
 let result=decide(d?.bars??[],m,{fresh,dataMode:mode,quote:d?.quote,symbol,cost:costForSymbol(symbol)});
 if(!fresh)result={...result,side:'HOLD',reason:f.status==='closed'?'Marché fermé':'Données historiques ou périmées',confidence:{...result.confidence,percent:null,classProbs:null,status:'stale'}};
 else if(jobs.get(symbol)?.status!=='ready')result={...result,side:'HOLD',reason:'Calibration en cours',entry:null,stop:null,target:null,confidence:{...result.confidence,percent:null,classProbs:null,status:'pending'}};
 else result=applyModelAssessment(result,m);
 const book=symbol==='BTC/USD'?bookFeed.snapshot():null,quote=book?.checksumValid&&book?.eventTime&&d?.quote?{...d.quote,bid:book.bestBid,ask:book.bestAsk,tradeEventTime:d.quote.eventTime,eventTime:book.eventTime,receivedAt:book.eventTime,localReceivedAt:book.receivedAt,bookEventTime:book.eventTime,transport:'websocket'}:d?.quote;
 const trade=liveTradeCandidate(d?.bars??[],{symbol,source:d?.source,quote,cost:costForSymbol(symbol),model:publishedModels.get(symbol),asOf:Date.now(),fresh,executable:symbol!=='NDX'&&fresh});
 return {...trade,dataMode:mode,directionalContext:result.confidence,filteredByFreshness:!fresh,filteredByH1:trade.filteredByHigherTimeframe??false,
  filteredByModelEvidence:trade.modelAssessment?.passed!==true,filteredByConfidence:Boolean(trade.candidateSide&&trade.modelAssessment?.passed&&!trade.confidenceGate?.passed),
  entry:trade.side==='HOLD'?null:trade.entry,stop:trade.side==='HOLD'?null:trade.stop,target:trade.side==='HOLD'?null:trade.target,
  setup:trade.setup?{...trade.setup,confirmed:trade.side!=='HOLD',entry:trade.side==='HOLD'?null:trade.entry}:undefined};
}
function executionQuote(symbol,quote){const b=symbol==='BTC/USD'?bookFeed.snapshot():null;return b?.checksumValid&&b.eventTime?{...quote,bid:b.bestBid,ask:b.bestAsk,tradeEventTime:quote?.eventTime,eventTime:b.eventTime,receivedAt:b.eventTime,localReceivedAt:b.receivedAt,transport:'websocket'}:quote;}
function rows(){return marketSymbols.map(symbol=>{
 const d=datasets.get(symbol),decision=current(symbol),f=feed(d),job=jobs.get(symbol)??{status:'pending',version:0},live=symbol!=='NDX'&&recent(d),source=d?.source??null;
 const row={symbol,source,timeframe:15,asOf:d?.bars.at(-1)?.time??null,bars:d?.bars.slice(-85)??[],chartHistory:d?.bars.slice(-320)??[],quote:d?.quote?executionQuote(symbol,d.quote):null,currentBar:d?.currentBar??f.currentBar??null,live,provenance:d?.provenance??{},quality:d?.quality??{},feed:{...f,status:d?f.status:'unavailable',telemetry:telemetry.get(symbol)?.snapshot()??null},microstructure:symbol==='BTC/USD'?bookFeed.snapshot():{status:'unavailable',reason:'Carnet consolidé non fourni'},tradeModel:publishedModels.has(symbol)?{status:publishedModels.get(symbol).publication?.passed?'validated':'research',trainedThrough:publishedModels.get(symbol).trainedThrough,publication:publishedModels.get(symbol).publication,audit:researchAudits.get(symbol)??null,algorithm:publishedModels.get(symbol).algorithm}:{status:'unavailable'},model:job,decision,signal:decision,eligible:profile.allowedSymbols.includes(symbol),signals:d?.closedSignals??[],previewSignals:[],coverage:d?.bars.length??0,execution:live?'Paper sur cet appareil':'Non exécutable'};
 row.research=labs.get(symbol)?.datasetVersion===job.version?labs.get(symbol).research:null;row.decisionChecks=decisionDiagnostics(row);row.strategyEvidence=strategyEvidence(labs.get(symbol),decision.strategy);row.replay=replays.get(symbol)??null;
 row.ideas=d?.bars.length>=60?rankIdeas(buildIdeaSetups(d),{quote:d.quote,decision,live,isFresh:recent(d)}):[];
 row.holdReason=explainHold(d,decision,{isFresh:recent(d)});return row;
});}
function equity(){const realized=positions.filter(p=>p.status==='closed').reduce((s,p)=>s+p.pnl,0),floating=positions.filter(p=>p.status==='open').reduce((s,p)=>{const px=exitQuotePrice(executionQuote(p.symbol,datasets.get(p.symbol)?.quote),p.side)??p.entry,dir=p.side==='BUY'?1:-1;return s+dir*(px-p.entry)*p.quantity-roundTripFee(p.cost,p.entry,px)*p.quantity;},0),value=profile.capital+realized+floating,day=new Intl.DateTimeFormat('en-CA',{timeZone:profile.resetTimezone}).format(new Date());if(daily[day]===undefined){daily[day]=value;save();}
 const dayLoss=Math.max(0,daily[day]-value),totalLoss=Math.max(0,profile.capital-value),openRisk=positions.filter(p=>p.status==='open').reduce((s,p)=>s+p.netRisk*p.quantity,0);
 return {capital:profile.capital,equity:value,realized,floating,dayLoss,totalLoss,openRisk,target:profile.capital*profile.targetPercent/100,remaining:Math.max(0,profile.capital*(1+profile.targetPercent/100)-value),tradingDays:new Set(positions.map(p=>p.openedAt.slice(0,10))).size,breached:dayLoss>=profile.capital*profile.dailyLossPercent/100||totalLoss>=profile.capital*profile.totalLossPercent/100};
}
function finish(p,reason){const d=datasets.get(p.symbol);if(!recent(d)||d.source!==p.source)throw Error('Cotation actuelle indisponible');const dir=p.side==='BUY'?1:-1,q=executionQuote(p.symbol,d.quote),px=dir===1?(q.bid??q.price):(q.ask??q.price),exit=px*(1-dir*p.cost.slippageBps/10000);Object.assign(p,{status:'closed',exit,pnl:(dir*(exit-p.entry)-roundTripFee(p.cost,p.entry,exit))*p.quantity,reason,closedAt:iso()});save();}
function observeDirect(symbol){const d=datasets.get(symbol);if(!d?.quote||!d.source)return;
 const stream=d.source==='Kraken public · spot'?kraken:deriv,book=symbol==='BTC/USD'?bookFeed.snapshot():null;
 const interrupted=['reconnecting','stale'].includes(stream.status)||book?.reason&&book.reason!=='Snapshot requis';
 const quote={...executionQuote(symbol,d.quote),streamInterrupted:Boolean(interrupted),observationSession:observeDirect.sessionId??(observeDirect.sessionId=crypto.randomUUID()),streamGeneration:String(stream.generation??0)+(book?':book:'+bookFeed.generation:''),streamConnectedAt:stream.connectedAt};
 let changed=false;
 // A known disconnect/checksum failure marks missing coverage immediately,
 // even when there is no fresh packet to settle a simulated exit yet.
 if(interrupted)for(const record of [...positions,...followups])if(record.symbol===symbol&&record.source===d.source&&['open','watching'].includes(record.status)&&!record.observationGap){record.observationGap=true;changed=true;}
 const updates=paperQuoteUpdates(positions,symbol,d.source,quote);
 for(const update of updates){const p=positions.find(p=>p.id===update.id);if(p&&p.status==='open'){if(p.observationSession!==update.observationSession||p.streamGeneration!==update.streamGeneration||p.observationGap!==update.observationGap)changed=true;Object.assign(p,update);if(update.status==='closed')changed=true;}}
 for(const f of followups){if(f.symbol!==symbol||f.source!==d.source||f.status!=='watching')continue;
  const tracking={...f,status:'open',openedAt:f.signalObservedAt??f.observedAt,quantity:1,cost:f.plan?.cost??costForSymbol(f.symbol),expiryAt:f.plan?.expiryTime??f.horizonEndAt};
  const update=paperQuoteUpdates([tracking],symbol,d.source,quote)[0];if(!update)continue;
  if(f.observationSession!==update.observationSession||f.streamGeneration!==update.streamGeneration||f.observationGap!==update.observationGap)changed=true;
  Object.assign(f,{lastObservationTime:update.lastObservationTime,observationGap:update.observationGap,observationSession:update.observationSession,streamGeneration:update.streamGeneration});
  if(update.status==='closed'){Object.assign(f,{status:update.outcome==='censored'?'censored':update.outcome==='target'?'target-observed':update.outcome==='stop'?'stop-observed':'expired',observedBarrier:update.observedBarrier,observedAt:update.observedExitAt,observedPrice:update.observedPrice,reason:update.reason});changed=true;}
 }
 if(changed)save();
}
function observe(radar){for(const row of radar){if(!row.live)continue;const d=row.decision,price=row.quote.price;
 observeDirect(row.symbol);
 const key=[row.source,d.time,d.strategy,d.side].join('|');if(observed.get(row.symbol)===key)continue;observed.set(row.symbol,key);
 if(!['BUY','SELL'].includes(d.side)||!d.confidenceGate.passed||d.confidence.percent<=60||!d.modelAssessment?.passed)continue;
 const event={id:crypto.randomUUID(),type:'signal',mode:'observed-live',policy:signalPolicy.id,symbol:row.symbol,source:row.source,strategy:d.strategy,strategyName:d.strategyName,side:d.side,entry:d.entry,stop:d.stop,target:d.target,confidencePercent:d.confidence.percent,confidenceClass:d.confidence.class,confidenceKind:d.confidence.kind,signalTime:d.time,referenceTime:d.confidence.referenceTime,horizonEndAt:d.confidence.horizonEndAt,observedAt:iso()};history.unshift(event);history=history.slice(0,500);followups.unshift({...event,plan:d.executionPlan,status:'watching',signalObservedAt:event.observedAt});followups=followups.slice(0,500);save();}}
function snapshot(){const radar=rows();observe(radar);return {token,profile,account:equity(),positions,radar,marketHealth:radar.map(m=>marketHealth(m)),signalPolicy,platform,strategyCatalog:strategyRegistry,signalHistory:{mode:'observed-live',items:history},signalFollowup:{mode:'observed-levels',items:followups},news,sources:[],modelJobs:{active:fitting?1:0,queued:queue.size,concurrency:1}};}
function emit(){if(started)postMessage({type:'state',state:snapshot()});}
async function getJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Fournisseur indisponible');return r.json();}
async function btcHistory(){try{const o=await getJSON('/cloud/kraken');if(o.ohlc.error?.length||o.ticker.error?.length)throw Error();const key=Object.keys(o.ohlc.result).find(k=>k!=='last'),rows=o.ohlc.result[key],t=o.ticker.result[Object.keys(o.ticker.result)[0]],at=o.receivedAt;const bars=rows.map(r=>({time:new Date(r[0]*1000).toISOString(),open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[6],trades:+r[7]}));const value={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,bars:bars.slice(0,-1),currentBar:{...bars.at(-1),closed:false},quote:{price:+t.c[0],bid:+t.b[0],ask:+t.a[0],receivedAt:at,transport:'rest'}};const prior=datasets.get('BTC/USD');value.quote=selectKrakenQuote(prior?.quote,value.quote);install(value);kraken.seed('BTC/USD',value);}catch{}}
async function nasdaq(){try{install(await getJSON('/cloud/nasdaq'));}catch{}}
async function readNews(){try{const n=await getJSON('/cloud/news');news={...n,status:n.sources?.some(s=>s.status==='ok')?'ready':'unavailable',updatedAt:n.receivedAt};emit();}catch{news={status:'unavailable',items:[],sources:[]};}}
function publicModels(symbol){return {markets:marketSymbols.filter(s=>!symbol||s===symbol).map(s=>{const m=models.get(s)??{};return {symbol:s,source:datasets.get(s)?.source,version:jobs.get(s)?.version,status:jobs.get(s)?.status,trade:publishedModels.get(s)?{algorithm:publishedModels.get(s).algorithm,trainedThrough:publishedModels.get(s).trainedThrough,publication:publishedModels.get(s).publication}:null,algorithm:m.algorithm,selection:m.selection,test:m.test,training:m.training,calibration:m.calibration,cost:m.cost,expertSelection:m.expertSelection,directionalExperts:Object.fromEntries(Object.entries(m.directionalExperts??{}).map(([key,e])=>[key,{algorithm:e.algorithm,test:e.test,training:e.training,calibration:e.calibration,selection:e.selection,cost:e.cost}]))};})};}
async function api(url,value){const u=new URL(url,'https://device.invalid');if(u.pathname==='/api/state')return snapshot();if(u.pathname==='/api/model')return publicModels(u.searchParams.get('symbol'));if(u.pathname==='/api/registry')return {version:strategyRegistryVersion,researchVersion:researchCandidateVersion,strategies:[...strategyRegistry,...researchCandidates]};if(u.pathname==='/api/export'&&restoreBlocked)throw Error('Journal non restauré : les données originales restent conservées');if(u.pathname==='/api/export')return {schemaVersion:2,exportedAt:iso(),profile,positions,history,followups,daily};
 if(u.pathname==='/api/import'){const imported=validatePrivateImport(value);restoreBlocked=false;platform={...platform,privateRestore:{status:'restored'}};profile=imported.profile;positions=imported.positions;history=imported.history;followups=imported.followups;daily=imported.daily;observed.clear();save();emit();return {imported:true,positions:positions.length};}
 if(u.pathname==='/api/research'){const symbol=u.searchParams.get('symbol');return {symbol,lab:labs.get(symbol)??null,replay:replays.get(symbol)??null,tradeModel:publishedModels.get(symbol)?.publication??null,tradeAudit:researchAudits.get(symbol)??null};}
 if(u.pathname==='/api/profile'){if(restoreBlocked)throw Error('Restaurer le journal avant de modifier le profil');const p=validateProfile(value);if(positions.length&&(p.capital!==profile.capital||p.resetTimezone!==profile.resetTimezone))throw Error('Capital et fuseau verrouillés après le premier trade');profile=p;save();emit();return profile;}
 if(u.pathname==='/api/paper/close'){const p=positions.find(p=>p.id===value.id&&p.status==='open');if(!p)throw Error('Position absente');finish(p,'Clôture manuelle paper');emit();return p;}
 if(u.pathname==='/api/paper/open'){if(restoreBlocked)throw Error('Restauration du journal bloquée');const symbol=value.symbol,d=datasets.get(symbol),s=current(symbol),ac=equity();if(!profile.confirmed||!profile.allowedSymbols.includes(symbol)||!recent(d)||symbol==='NDX'||d?.source==null)throw Error('Profil ou cotation non exécutable');if(ac.breached)throw Error('Limite de perte atteinte');if(s.side==='HOLD'||!s.modelAssessment?.passed||!s.confidenceGate?.passed||s.confidence.percent<=60||s.strategy!==value.strategy||!s.executionPlan?.valid)throw Error('Signal confirmé > 60 % requis');if(positions.some(p=>p.symbol===symbol&&p.status==='open'))throw Error('Position déjà ouverte');const plan=s.executionPlan,cost=costForSymbol(symbol),sized=sizePosition({capital:Math.min(ac.equity,profile.capital),riskPercent:profile.riskPercent,entry:plan.entry,stop:plan.stop,unitRisk:plan.netRisk});if(ac.openRisk+plan.netRisk*sized.quantity>profile.capital*profile.openRiskPercent/100)throw Error('Risque ouvert dépassé');if(positions.filter(p=>p.status==='open').reduce((sum,p)=>sum+p.entry*p.quantity,0)+sized.notional>ac.equity)throw Error('Exposition supérieure au capital');const p={id:crypto.randomUUID(),symbol,source:d.source,strategy:s.strategy,side:s.side,entry:plan.entry,stop:plan.stop,target:plan.target,netRisk:plan.netRisk,...sized,cost,status:'open',openedAt:plan.executionTime??iso(),mode:'paper-device',plan:s.executionPlan,expiryAt:s.executionPlan.expiryTime,confidenceKind:s.confidence.kind,confidencePercent:s.confidence.percent};positions.unshift(p);save();emit();return p;}
 throw Error('Route inconnue');}
self.onmessage=async({data:m})=>{if(['model-fit','model-complete','model-error'].includes(m.type)){modelReply(m);return;}if(m.type==='init'&&!started){try{if(m.saved){const restored=validatePrivateImport({...m.saved,profile:m.saved.profile??profile});profile=restored.profile;positions=restored.positions;history=restored.history;followups=restored.followups;daily=restored.daily;}}catch(e){restoreBlocked=true;platform={...platform,privateRestore:{status:'blocked',reason:e.message}};postMessage({type:'private-restore-error',error:e.message});}started=true;for(const cached of await readHistory()){const expected=cached.symbol==='BTC/USD'?'Kraken public · spot':cached.symbol==='NDX'?'Yahoo Finance · Nasdaq-100 index':DERIV_SOURCE;if(marketSymbols.includes(cached.symbol)&&cached.source===expected&&cached.timeframe===15){try{install({...cached,quote:null,currentBar:null,live:false});}catch{}}}kraken.start();bookFeed.start();deriv.start();loadPlatform();loadPublishedModels();btcHistory();nasdaq();readNews();emit();setInterval(()=>{deriv.stop();deriv.start();},23*3600000);setInterval(emit,1000);setInterval(btcHistory,60000);setInterval(nasdaq,60000);setInterval(readNews,300000);}if(m.type==='api'){try{postMessage({type:'reply',id:m.id,value:await api(m.url,m.value)});}catch(e){postMessage({type:'reply',id:m.id,error:e.message});}}};
