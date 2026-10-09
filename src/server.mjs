import http from 'node:http';
import {decisionDiagnostics} from './decision-diagnostics.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {validateBars,signal,strategies,sizePosition,indicators} from './engine.mjs';
import {KrakenLiveFeed} from './live-feed.mjs';
import {loadProviderImport,normalizeProviderImport,fetchYahooSnapshot} from './provider-import.mjs';
import {ModelWorkerPool} from './model-worker.mjs';
import {decide,featureWindow,signalPolicy} from './decision.mjs';
import {DerivLiveFeed,DERIV_SOURCE,DERIV_SYMBOLS} from './deriv-feed.mjs';
import {buildIdeaSetups,rankIdeas,explainHold} from './ideas.mjs';
import {NewsService} from './news.mjs';
import {costForSymbol} from './cost-policy.mjs';
import {strategyEvidence} from './strategy-evidence.mjs';
import {SignalFollowup} from './signal-followup.mjs';
import {marketHealth} from './market-health.mjs';
import {applyModelAssessment} from './model-assessment.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const marketSymbols=Object.freeze(['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX']);
export const defaultProfile={name:'Mon challenge',capital:100000,targetPercent:8,dailyLossPercent:3,totalLossPercent:6,riskPercent:.25,openRiskPercent:.75,minDays:0,resetTimezone:'Africa/Casablanca',allowedSymbols:[...marketSymbols],confirmed:false,deadlineSessions:3};
export function validateProfile(p){
  if(typeof p.name!=='string'||p.name.length>80||!p.name.trim()||!Array.isArray(p.allowedSymbols)||p.allowedSymbols.length>12||p.allowedSymbols.some(s=>!['EUR/USD','GBP/USD','USD/JPY','XAU/USD','BTC/USD','ETH/USD','SPY','QQQ','NDX'].includes(s))||typeof p.confirmed!=='boolean')throw Error('Profil invalide');
  for(const [key,min,max] of [['capital',100,10000000],['targetPercent',.1,50],['dailyLossPercent',.1,20],['totalLossPercent',.1,50],['riskPercent',.01,1],['openRiskPercent',.01,3],['minDays',0,100]])if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw Error('Valeur invalide : '+key);
  if(!Number.isInteger(p.minDays)||p.riskPercent>p.openRiskPercent||p.dailyLossPercent>p.totalLossPercent)throw Error('Limites incohérentes');
  try{new Intl.DateTimeFormat('en',{timeZone:p.resetTimezone}).format();}catch{throw Error('Fuseau invalide');}
  return {...defaultProfile,...p,deadlineSessions:3};
}
export function createApp({port=4328,dbPath=path.join(root,'runtime','funded.sqlite'),network=true,initialDatasets=null,liveFeedFactory=options=>new KrakenLiveFeed(options),derivFeedFactory=options=>new DerivLiveFeed(options),importsPath=path.join(root,'data','imports'),providerFetcher=fetchYahooSnapshot,modelPoolFactory=options=>new ModelWorkerPool(options),newsServiceFactory=options=>new NewsService(options)}={}){
  mkdirSync(path.dirname(dbPath),{recursive:true});const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, time TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS day_equity (day TEXT PRIMARY KEY, equity REAL NOT NULL);');
  db.exec('CREATE TABLE IF NOT EXISTS signal_state (symbol TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  const signalFollowup=new SignalFollowup(db);
  const token=randomBytes(24).toString('hex');let datasets=new Map(),labs=new Map(),signalCache=new Map(),ideaCache=new Map(),calibrations=new Map(),modelStates=new Map(),versions=new Map(),fingerprints=new Map(),refreshing=null,lastRefresh=null,feedErrors={},liveFeed=null,derivFeed=null,stopping=false,modelsStarted=false;
  const clients=new Set(),lifecycle=new AbortController(),evidenceCache=new Map(),replayCache=new Map();
  const newsService=newsServiceFactory({});const monitoringSince=new Date().toISOString();
  function acceptModel(result){
    const d=datasets.get(result.symbol);
    if(stopping||versions.get(result.symbol)!==result.version||d?.source!==result.source)return;
    const lab=result.laboratory;
    if(lab&&lab.symbol===result.symbol&&lab.source===result.source&&lab.from===d.bars[0]?.time&&lab.to===d.bars.at(-1)?.time&&lab.bars===d.bars.length){
      labs.set(result.symbol,lab);
      const replay=result.replay;
      if(replay&&replay.symbol===d.symbol&&replay.source===d.source&&replay.bars===d.bars.length&&replay.from===d.bars[0]?.time&&replay.to===d.bars.at(-1)?.time)replayCache.set(d.symbol,{...replay,version:result.version});
      // Validate each report once per completed laboratory, away from 1 Hz pushes.
      evidenceCache.set(result.symbol,new Map(strategies.map(rule=>[rule.id,strategyEvidence(lab,rule.id)])));
    }
    calibrations.set(result.symbol,result.calibration);modelStates.set(result.symbol,{status:'ready',version:result.version,source:result.source,trainedAt:result.trainedAt,error:null});
  }
  const modelPool=modelPoolFactory({
    onResult:acceptModel,onCalibration:acceptModel,
    onError:result=>{if(stopping||versions.get(result.symbol)!==result.version)return;calibrations.delete(result.symbol);labs.delete(result.symbol);evidenceCache.delete(result.symbol);replayCache.delete(result.symbol);modelStates.set(result.symbol,{status:'error',version:result.version,source:result.source,trainedAt:null,error:'Calcul du modèle indisponible'});}
  });
  const profile=()=>JSON.parse(db.prepare('SELECT value FROM settings WHERE id=?').get('profile')?.value??JSON.stringify(defaultProfile));
  const positions=()=>db.prepare('SELECT payload FROM positions ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));
  function savePosition(p){db.prepare('INSERT OR REPLACE INTO positions VALUES (?,?)').run(p.id,JSON.stringify(p));}
  function event(value){const id=randomUUID();db.prepare('INSERT INTO events VALUES (?,?,?)').run(id,new Date().toISOString(),JSON.stringify(value));return id;}
  function install(d){
    if(stopping)return;
    d={...d,bars:validateBars(d.bars).filter(b=>Date.parse(b.time)+(d.timeframe??15)*60000<=Date.now())};
    const previous=datasets.get(d.symbol);
    // Keep one provider's history through silence/reconnection; resumed ticks must still match its source.
    if(network&&previous?.source===DERIV_SOURCE&&d.source!==DERIV_SOURCE&&derivFeed)return;
    if(previous?.source===d.source){const canonicalHistory=d.symbol==='NDX'&&d.source==='Yahoo Finance · Nasdaq-100 index'&&d.provenance?.sessionValidated===true&&d.provenance?.historyMode==='canonical-provider-snapshot';
      if(!canonicalHistory){const combined=new Map([...previous.bars,...d.bars].map(b=>[b.time,b]));d.bars=[...combined.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-20000);}
      if(previous.quote?.transport==='websocket'&&Date.now()-Date.parse(previous.quote.receivedAt)<30000)d.quote=previous.quote;
    }
    if(d.bars.length<60)throw Error('Historique insuffisant');
    const fingerprint=createHash('sha256').update(d.source+'\n'+JSON.stringify(d.bars.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]))).digest('hex'),changed=fingerprints.get(d.symbol)!==fingerprint;
    datasets.set(d.symbol,d);
    if(changed){fingerprints.set(d.symbol,fingerprint);const analysisBars=d.bars.slice(-featureWindow),context=indicators(analysisBars),signals=strategies.map(s=>signal(analysisBars,s.id,context));signalCache.set(d.symbol,signals);if(marketSymbols.includes(d.symbol))ideaCache.set(d.symbol,buildIdeaSetups(d,{signals,context}));const version=(versions.get(d.symbol)??0)+1;versions.set(d.symbol,version);
      if(marketSymbols.includes(d.symbol)){calibrations.delete(d.symbol);labs.delete(d.symbol);evidenceCache.delete(d.symbol);replayCache.delete(d.symbol);modelStates.set(d.symbol,{status:'pending',version,source:d.source,trainedAt:null,error:null});if(modelsStarted)modelPool.schedule(d,version);}
    }
    liveFeed?.seed(d.symbol,d);
    if(d.source===DERIV_SOURCE)derivFeed?.seed(d.symbol,d);
    if(network&&d.live&&changed){const dir=path.join(path.dirname(dbPath),'feeds');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,Buffer.from(d.symbol).toString('hex')+'.json'),JSON.stringify({...d,live:false}));}
  }
  for(const f of readdirSync(path.join(root,'data')).filter(f=>f.endsWith('.json'))){try{install(JSON.parse(readFileSync(path.join(root,'data',f),'utf8')));}catch(e){feedErrors[f]=e.message;}}
  for(const d of initialDatasets??[])install(d);
  if(network){const dir=path.join(path.dirname(dbPath),'feeds');mkdirSync(dir,{recursive:true});for(const f of readdirSync(dir).filter(f=>/^[0-9a-f]+\.json$/.test(f))){try{install(JSON.parse(readFileSync(path.join(dir,f),'utf8')));}catch{feedErrors[f]='Cache de données invalide';}}}
  function loadImports(){if(!existsSync(importsPath))return;for(const filename of readdirSync(importsPath).filter(f=>f.endsWith('.json'))){try{const d=loadProviderImport(path.join(importsPath,filename));install(d);delete feedErrors[d.symbol];}catch{feedErrors[filename]='Import fournisseur invalide ou indisponible';}}}
  loadImports();modelsStarted=true;for(const symbol of marketSymbols){const d=datasets.get(symbol);if(d)modelPool.schedule(d,versions.get(symbol));}
  async function json(url){const r=await fetch(url,{signal:AbortSignal.any([AbortSignal.timeout(12000),lifecycle.signal])});if(!r.ok)throw Error('Fournisseur HTTP '+r.status);return r.json();}
  async function kraken(symbol,pair){
    const [o,t]=await Promise.all([json('https://api.kraken.com/0/public/OHLC?pair='+pair+'&interval=15'),json('https://api.kraken.com/0/public/Ticker?pair='+pair)]);if(o.error?.length||t.error?.length)throw Error('Kraken : réponse refusée');const k=Object.keys(o.result).find(k=>k!=='last'),ticker=Object.values(t.result)[0];
    const receivedAt=new Date().toISOString(),rows=o.result[k].map(r=>({time:new Date(r[0]*1000).toISOString(),open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[6],trades:+r[7]}));
    install({symbol,source:'Kraken public · spot',timeframe:15,receivedAt,quote:{bid:+ticker.b[0],ask:+ticker.a[0],price:+ticker.c[0],receivedAt,eventTime:null,source:'Kraken REST ticker',transport:'rest'},currentBar:{...rows.at(-1),closed:false,receivedAt,source:'Kraken REST OHLC',transport:'rest'},bars:rows.slice(0,-1),live:true});delete feedErrors[symbol];
  }
  async function twelve(symbol){
    const key=process.env.TWELVE_DATA_API_KEY;const [b,q]=await Promise.all([json('https://api.twelvedata.com/time_series?symbol='+encodeURIComponent(symbol)+'&interval=15min&outputsize=1000&timezone=UTC&apikey='+encodeURIComponent(key)),json('https://api.twelvedata.com/quote?symbol='+encodeURIComponent(symbol)+'&apikey='+encodeURIComponent(key))]);if(!b.values||q.status==='error')throw Error('Twelve Data : quota, accès ou symbole indisponible');
    install(normalizeProviderImport({provider:'Twelve Data',symbol,payload:b,quote:q,fetchedAt:new Date().toISOString(),timezone:'UTC'}));delete feedErrors[symbol];
  }
  function fresh(d){return !!d?.live&&!!d.quote&&Number.isFinite(d.quote.price)&&d.quote.price>0&&Date.now()-Date.parse(d.quote.receivedAt)<(d.quote.transport==='websocket'?30000:120000)&&Date.now()>=Date.parse(d.quote.receivedAt)-60000;}
  function quoteRecent(d){return !!d?.quote&&Number.isFinite(d.quote.price)&&d.quote.price>0&&Date.now()-Date.parse(d.quote.receivedAt)<(d.quote.transport==='websocket'?30000:120000)&&Date.now()>=Date.parse(d.quote.receivedAt)-60000;}
  function closedRecent(d){const interval=(d?.timeframe??15)*60000,closedAge=Date.now()-Date.parse(d?.bars.at(-1)?.time)-interval;return closedAge>=0&&closedAge<interval;}
  function streamFor(d){return !network?null:d?.source==='Kraken public · spot'?liveFeed?.snapshot(d.symbol):d?.source===DERIV_SOURCE?derivFeed?.snapshot(d.symbol):null;}
  function routedDecision(d){
    const stream=streamFor(d),model=modelStates.get(d.symbol),marketOpen=d.provenance?.marketOpen!==false,
      dataMode=marketOpen&&fresh(d)&&(!stream||stream.status==='live')?'live':d.isRealtime===false||d.provenance?.mode==='snapshot'?'snapshot':'historical',
      isFresh=marketOpen&&quoteRecent(d)&&closedRecent(d)&&(!stream||stream.status==='live');
    const decision=decide(d.bars,calibrations.get(d.symbol)??null,{fresh:isFresh,dataMode,quote:d.quote,symbol:d.symbol,cost:costForSymbol(d.symbol)});
    if(!isFresh)return {...decision,side:'HOLD',dataMode,confidence:{...decision.confidence,percent:null,classProbs:null,status:'stale'},reason:marketOpen?'Données historiques ou périmées':'Marché fermé'};
    if(model?.status!=='ready')return {...decision,side:'HOLD',dataMode,confidence:{...decision.confidence,percent:null,classProbs:null,status:model?.status??'pending'},reason:model?.status==='error'?'Modèle indisponible':'Calibration en cours'};
    return applyModelAssessment({...decision,dataMode},calibrations.get(d.symbol));
  }
  function executionFresh(d){
    if(!exitFresh(d))return false;
    const interval=(d.timeframe??15)*60000,closedAge=Date.now()-Date.parse(d.bars.at(-1)?.time)-interval;
    const stream=streamFor(d);return closedAge>=0&&closedAge<interval&&(!stream||stream.status==='live');
  }
  function exitFresh(d){if(!fresh(d))return false;const stream=streamFor(d);return !stream||stream.status==='live';}
  function mark(){for(const p of positions().filter(p=>p.status==='open')){const d=datasets.get(p.symbol);if(!exitFresh(d)||d.source!==p.source)continue;const price=p.side==='BUY'?(d.quote.bid??d.quote.price):(d.quote.ask??d.quote.price);if((p.side==='BUY'&&(price<=p.stop||price>=p.target))||(p.side==='SELL'&&(price>=p.stop||price<=p.target))){finish(p,price,Math.abs(price-p.stop)<Math.abs(price-p.target)?'Stop observé':'Objectif observé');}}}
  function observeSignals(){
    if(!network||stopping)return;
    for(const symbol of marketSymbols){const d=datasets.get(symbol);if(!d||!executionFresh(d)||modelStates.get(symbol)?.status!=='ready')continue;
      const decision=routedDecision(d),signature=[signalPolicy.id,d.source,decision.time,decision.strategy,decision.side].join('|'),previous=db.prepare('SELECT payload FROM signal_state WHERE symbol=?').get(symbol);
      if(previous&&JSON.parse(previous.payload).signature===signature)continue;
      const observedAt=new Date().toISOString();
      db.exec('BEGIN');
      try{
        db.prepare('INSERT OR REPLACE INTO signal_state VALUES (?,?)').run(symbol,JSON.stringify({signature,side:decision.side,strategy:decision.strategy,source:d.source,observedAt}));
        if(decision.side==='BUY'||decision.side==='SELL'){
          const observation={type:'signal',mode:'observed-live',policy:signalPolicy.id,confidencePercent:decision.confidence.percent,confidenceClass:decision.confidence.class,symbol,source:d.source,strategy:decision.strategy,strategyName:decision.strategyName,side:decision.side,signalTime:decision.time,referenceTime:decision.confidence.referenceTime,horizonEndAt:decision.confidence.horizonEndAt,observedAt,quoteTime:d.quote.receivedAt,quotePrice:d.quote.price,entry:decision.entry,stop:decision.stop,target:decision.target};
          signalFollowup.record(event(observation),observation);
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  }
  function observeSignalLevels(){
    signalFollowup.expire();
    if(!network)return;
    for(const symbol of marketSymbols){const d=datasets.get(symbol);if(d)signalFollowup.observe({symbol,source:d.source,quote:d.quote,fresh:exitFresh(d)});}
  }
  function signalHistory(symbol){const items=db.prepare("SELECT id,time,payload FROM events WHERE json_extract(payload,'$.type')='signal' ORDER BY time DESC LIMIT 100").all().map(row=>({id:row.id,time:row.time,...JSON.parse(row.payload)})).filter(item=>!symbol||item.symbol===symbol);return {mode:'observed-live',monitoringSince,items};}
  function finish(p,price,reason){const dir=p.side==='BUY'?1:-1,exit=price*(1-dir*p.slippageBps/10000),pnl=dir*(exit-p.entry)*p.quantity-(exit+p.entry)*p.quantity*p.feeBps/10000;savePosition({...p,status:'closed',exit,pnl,closedAt:new Date().toISOString(),reason});event({type:'close',symbol:p.symbol,pnl,reason});}
  function account(){const pr=profile(),ps=positions(),closed=ps.filter(x=>x.status==='closed'),realized=closed.reduce((s,p)=>s+p.pnl,0),floating=ps.filter(x=>x.status==='open').reduce((s,p)=>{const d=datasets.get(p.symbol),px=d?.quote?.price??p.entry,dir=p.side==='BUY'?1:-1;return s+dir*(px-p.entry)*p.quantity-(px+p.entry)*p.quantity*p.feeBps/10000;},0),equity=pr.capital+realized+floating,day=new Intl.DateTimeFormat('en-CA',{timeZone:pr.resetTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());db.prepare('INSERT OR IGNORE INTO day_equity VALUES (?,?)').run(day,equity);const dayStart=db.prepare('SELECT equity FROM day_equity WHERE day=?').get(day).equity;
    return {capital:pr.capital,equity,realized,floating,dayStart,dayLoss:Math.max(0,dayStart-equity),totalLoss:Math.max(0,pr.capital-equity),target:pr.capital*pr.targetPercent/100,remaining:Math.max(0,pr.capital*(1+pr.targetPercent/100)-equity),tradingDays:new Set(ps.map(p=>new Intl.DateTimeFormat('en-CA',{timeZone:pr.resetTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.openedAt)))).size,openRisk:ps.filter(p=>p.status==='open').reduce((s,p)=>s+p.risk,0),stalePositions:ps.filter(p=>p.status==='open'&&!fresh(datasets.get(p.symbol))).length};
  }
  function replaySnapshot(symbol,full=false){
    const replay=replayCache.get(symbol);
    if(!replay)return {symbol,status:modelStates.get(symbol)?.status==='pending'?'pending':'unavailable',reason:'Replay du moteur en préparation'};
    const {trades,...summary}=replay;
    return {...summary,recentTrades:trades.slice(-8),...(full?{trades}:{} )};
  }
  function radar(){const allowed=profile().allowedSymbols;return marketSymbols.map(symbol=>{
    const d=datasets.get(symbol);
    if(!d){const decision={side:'HOLD',strategy:null,reason:'Données fournisseur indisponibles',closed:true,dataMode:'unavailable',confidence:{percent:null,classProbs:null,status:'unavailable',reason:'Aucune donnée fournisseur valide',kind:'market_class_probability',class:'FLAT',horizonMinutes:60}};return {symbol,source:null,timeframe:15,asOf:null,quote:null,live:false,currentBar:null,previewSignals:[],signal:decision,decision,strategyEvidence:strategyEvidence(null,null),signals:[],ideas:[],holdReason:explainHold(null,decision),selectedStrategy:null,validationStatus:'Données indisponibles',bars:[],coverage:0,provenance:null,quality:{warning:'Données fournisseur indisponibles'},feed:{status:'unavailable',transport:null,lastEventAt:null,ageMs:null},model:{status:'unavailable',version:null,trainedAt:null},execution:'Indisponible',eligible:allowed.includes(symbol)};}
    const signals=[...(signalCache.get(symbol)??[])],interval=(d.timeframe??15)*60000,marketStream=streamFor(d),
      currentBar=marketStream?.currentBar??(d.currentBar&&Date.parse(d.currentBar.time)+interval>Date.now()?d.currentBar:null),
      isLive=d.provenance?.marketOpen!==false&&fresh(d)&&closedRecent(d)&&(!marketStream||marketStream.status==='live'),decision=routedDecision(d),
      previewBars=currentBar&&isLive?[...d.bars,currentBar].slice(-featureWindow):null,previewContext=previewBars?indicators(previewBars,{includeForming:true}):null,
      previewSignals=previewBars?strategies.map(s=>({...signal(previewBars,s.id,previewContext),provisional:true,closed:false})):[];
    const snapshotStatus=d.provenance?.marketOpen===false?'closed':quoteRecent(d)?'snapshot':'historical';
    const ideasFresh=d.provenance?.marketOpen!==false&&quoteRecent(d)&&closedRecent(d)&&(!marketStream||marketStream.status==='live'),ideas=rankIdeas(ideaCache.get(symbol)??[],{quote:d.quote,decision,live:isLive,isFresh:ideasFresh});
    return {symbol,source:d.source,timeframe:d.timeframe??15,asOf:d.bars.at(-1)?.time,quote:d.quote??null,live:isLive,currentBar,previewSignals,
      feed:marketStream?{status:marketStream.status,transport:marketStream.transport,provider:marketStream.provider,lastEventAt:marketStream.lastEventAt,ageMs:marketStream.ageMs}:{status:snapshotStatus,transport:d.quote?.transport??'import',lastEventAt:d.quote?.receivedAt??null,ageMs:d.quote?Math.max(0,Date.now()-Date.parse(d.quote.receivedAt)):null},
      signal:decision,decision,decisionChecks:decisionDiagnostics({symbol,source:d.source,decision,bars:d.bars.slice(-85),timeframe:d.timeframe??15,live:isLive,feed:{status:marketStream?.status??snapshotStatus},quote:d.quote}),replay:replaySnapshot(symbol),strategyEvidence:evidenceCache.get(symbol)?.get(decision.strategy)??strategyEvidence(null,decision.strategy),signals,ideas,holdReason:explainHold(d,decision,{isFresh:ideasFresh}),selectedStrategy:decision.strategy,validationStatus:calibrations.get(symbol)?.status??'Calibration en cours',bars:d.bars.slice(-85),coverage:d.bars.length,provenance:d.provenance??null,staleAt:d.staleAt??null,model:modelStates.get(symbol)??{status:'pending'},
      quality:{...d.quality,zeroVolume:d.bars.filter(b=>b.volume===0).length,warning:d.quality?.warning??null},execution:!executionFresh(d)?'Historique / snapshot non exécutable':decision.side==='HOLD'?'Déclencheur en attente':'Décision actuelle',eligible:allowed.includes(symbol)};
  });}
  async function refresh(){if(stopping)return;if(refreshing)return refreshing;refreshing=(async()=>{loadImports();if(network){const tasks=[['BTC/USD',()=>kraken('BTC/USD','XBTUSD')],['ETH/USD',()=>kraken('ETH/USD','ETHUSD')],['NDX',async()=>{install(await providerFetcher('NDX',{signal:lifecycle.signal}));delete feedErrors.NDX;}]];
      if(process.env.TWELVE_DATA_API_KEY)for(const s of ['EUR/USD','GBP/USD','XAU/USD'])tasks.push([s,()=>twelve(s)]);
      else for(const s of ['EUR/USD','GBP/USD'])tasks.push([s,async()=>{install(await providerFetcher(s,{signal:lifecycle.signal}));delete feedErrors[s];}]);
      await Promise.allSettled(tasks.map(async([s,fn])=>{try{await fn();}catch{feedErrors[s]='Flux indisponible : vérifier accès, réseau ou quota';}}));}if(!stopping){mark();lastRefresh=new Date().toISOString();}})();try{await refreshing;}finally{refreshing=null;}}
  function modelDiagnostics(){return marketSymbols.map(symbol=>{const model=calibrations.get(symbol);return {symbol,...modelStates.get(symbol),source:datasets.get(symbol)?.source??null,algorithm:model?.algorithm??null,selection:model?.selection??null,calibrationStatus:model?.status??'pending',reason:model?.reason??null,event:model?.event??null,cost:model?.cost??null,split:model?.split??null,trainingRange:model?.trainingRange??null,calibrationRange:model?.calibrationRange??null,testRange:model?.testRange??null,training:model?.training??null,calibration:model?.calibration??null,test:model?.test??null,calibrated:model?.calibrated??false,audited:model?.audited??false};});}
  function state(){const disabled={status:'disabled',connectedAt:null,lastMessageAt:null,reconnects:0,error:null},stream=liveFeed?.snapshot()??{provider:'Kraken WebSocket v2',...disabled},deriv=derivFeed?.snapshot()??{provider:'Deriv public · real FX / metals',...disabled},streamLabels={live:'En direct · 1 s',connecting:'Connexion en cours',reconnecting:'Reconnexion en cours',stale:'Flux périmé',offline:'Hors ligne',disabled:'Désactivé'};const markets=radar();return {token,profile:profile(),account:account(),radar:markets,marketHealth:markets.map(m=>marketHealth(m)),signalFollowup:signalFollowup.snapshot(),positions:positions(),lastRefresh,refreshing:!!refreshing,feedErrors,news:newsService.snapshot(),strategyCatalog:strategies,signalPolicy,signalHistory:signalHistory(),stream,streams:{kraken:stream,deriv},modelJobs:modelPool.snapshot(),sources:[{name:'Kraken',status:streamLabels[stream.status]??stream.status,detail:'BTC/USD spot · WebSocket v2 · bougie en formation'},{name:'Deriv',status:streamLabels[deriv.status]??deriv.status,detail:'EUR/USD · GBP/USD · XAU/USD · cotations du courtier · marchés réels, aucun indice synthétique'},{name:'Yahoo Finance',status:network?'Snapshots automatiques · 60 s':'Historique',detail:'Vrai indice Nasdaq-100 ^NDX · endpoint public non officiel · délai fournisseur non garanti'},{name:'Twelve Data',status:process.env.TWELVE_DATA_API_KEY?'Clé serveur configurée':datasets.get('XAU/USD')?.provenance?.provider==='Twelve Data'?'Import horodaté disponible':'Non connecté',detail:'Snapshots fournisseurs en secours · aucun import affiché comme flux direct'}]};}
  function removeClient(client){clearTimeout(client.timer);clients.delete(client);}
  function push(client){
    if(stopping||client.res.destroyed||client.res.writableEnded){removeClient(client);return;}
    if(client.res.writableLength>1000000){client.res.destroy();removeClient(client);return;}
    client.res.write('event: state\ndata: '+JSON.stringify(state())+'\n\n');
    // Schedule from this client's last write so timer jitter cannot skip an entire second.
    client.timer=setTimeout(()=>push(client),1000);client.timer.unref();
  }
  const server=http.createServer(async(req,res)=>{
    const send=(v,status=200,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?JSON.stringify(v):v);};
    try{const actualPort=server.address()?.port??port,hosts=['127.0.0.1:'+actualPort,'localhost:'+actualPort];if(!hosts.includes(req.headers.host)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!hosts.includes(req.headers.origin.replace('http://',''))))return send({error:'Origine refusée'},403);const url=new URL(req.url,'http://'+req.headers.host);
      if(req.method==='GET'){
        if(url.pathname==='/api/state')return send(state());
        if(url.pathname==='/api/stream'){
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
          res.write('retry: 2000\n\n');const client={res,timer:null};clients.add(client);push(client);req.on('close',()=>removeClient(client));return;
        }
        if(url.pathname==='/api/health'||url.pathname==='/api/followups'){
          const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);
          if(url.pathname==='/api/followups')return send(signalFollowup.snapshot({symbol}));
          return send({checkedAt:new Date().toISOString(),markets:radar().filter(m=>!symbol||m.symbol===symbol).map(m=>marketHealth(m))});
        }
        if(url.pathname==='/api/replay'){
          const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);
          return send(symbol?replaySnapshot(symbol,true):{markets:marketSymbols.map(s=>replaySnapshot(s))});
        }
        if(url.pathname==='/api/decision-checks'){const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);return send({checkedAt:new Date().toISOString(),markets:radar().filter(m=>!symbol||m.symbol===symbol).map(decisionDiagnostics)});}
        if(url.pathname==='/api/lab')return send(marketSymbols.map(symbol=>labs.get(symbol)).filter(Boolean));
        if(url.pathname==='/api/model')return send({jobs:modelPool.snapshot(),markets:modelDiagnostics()});
        if(url.pathname==='/api/news'){const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);return send(newsService.snapshot(symbol??undefined));}
        if(url.pathname==='/api/ideas'){const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);const markets=radar();return send(symbol?{symbol,items:markets.find(m=>m.symbol===symbol).ideas,holdReason:markets.find(m=>m.symbol===symbol).holdReason}:{markets:markets.map(m=>({symbol:m.symbol,items:m.ideas,holdReason:m.holdReason}))});}
        if(url.pathname==='/api/signals'){const symbol=url.searchParams.get('symbol');if(symbol&&!marketSymbols.includes(symbol))return send({error:'Instrument inconnu'},400);return send(signalHistory(symbol??undefined));}
        if(url.pathname==='/api/export')return send({exportedAt:new Date().toISOString(),profile:profile(),account:account(),positions:positions(),laboratory:marketSymbols.map(symbol=>labs.get(symbol)).filter(Boolean),models:modelDiagnostics(),signalFollowup:signalFollowup.snapshot(),events:db.prepare('SELECT * FROM events ORDER BY time DESC LIMIT 500').all().map(e=>({...e,payload:JSON.parse(e.payload)}))});
        const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/signal-alerts.js':['signal-alerts.js','text/javascript'],'/styles.css':['styles.css','text/css']};if(files[url.pathname]){const [f,t]=files[url.pathname];return send(readFileSync(path.join(root,'public',f),'utf8'),200,t);}return send({error:'Introuvable'},404);
      }
      if(req.method!=='POST')return send({error:'Méthode refusée'},405);if(req.headers['x-terminal-token']!==token)return send({error:'Session refusée'},403);let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)return send({error:'Requête trop grande'},413);}let value;try{value=JSON.parse(raw);}catch{return send({error:'JSON invalide'},400);}
      if(url.pathname==='/api/refresh'){await refresh();return send({ok:true});}
      if(url.pathname==='/api/profile'){const next=validateProfile(value);if(positions().length&&(next.capital!==profile().capital||next.resetTimezone!==profile().resetTimezone))throw Error('Capital et fuseau verrouillés après le premier trade');if(next.capital!==profile().capital||next.resetTimezone!==profile().resetTimezone)db.exec('DELETE FROM day_equity');db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('profile',JSON.stringify(next));event({type:'profile',name:next.name});return send({ok:true});}
      if(url.pathname==='/api/paper/open'){
        const pr=profile(),ac=account(),d=datasets.get(value.symbol);if(!pr.confirmed)throw Error('Confirmer les règles et instruments du challenge');if(!pr.allowedSymbols.includes(value.symbol))throw Error('Instrument hors du profil');if(!executionFresh(d))throw Error('Prix actuel ou flux confirmé indisponible');if(ac.stalePositions)throw Error('Une position ouverte a un prix expiré');
        if(ac.dayLoss>=pr.capital*pr.dailyLossPercent/100||ac.totalLoss>=pr.capital*pr.totalLossPercent/100)throw Error('Limite du challenge atteinte');if(positions().some(p=>p.status==='open'&&p.symbol===value.symbol))throw Error('Position déjà ouverte sur cet instrument');
        const s=routedDecision(d);if(s.side==='HOLD')throw Error('Déclencheur absent · décision confirmée absente : '+s.reason);if(s.strategy!==value.strategy)throw Error('Stratégie différente du routeur');if(s.side==='HOLD'||Date.now()-Date.parse(s.time)>1800000)throw Error('Déclencheur absent ou expiré');const plan=s.executionPlan;if(!plan?.valid)throw Error(plan?.reason??'Plan d’entrée indisponible');const cost=costForSymbol(value.symbol),{feeBps,slippageBps}=cost,{entry,stop,target}=plan;const sized=sizePosition({capital:Math.min(ac.equity,pr.capital),riskPercent:pr.riskPercent,entry,stop,feeBps,slippageBps,unitRisk:plan.netRisk});
        if(ac.openRisk+sized.risk>pr.capital*pr.openRiskPercent/100||ac.dayLoss+ac.openRisk+sized.risk>pr.capital*pr.dailyLossPercent/100||ac.totalLoss+ac.openRisk+sized.risk>pr.capital*pr.totalLossPercent/100)throw Error('Budget de risque insuffisant');
        const notional=positions().filter(p=>p.status==='open').reduce((x,p)=>x+p.quantity*p.entry,0);if(notional+sized.notional>ac.equity)throw Error('Exposition totale supérieure au capital simulé');const p={id:randomUUID(),symbol:value.symbol,source:d.source,strategy:value.strategy,side:s.side,entry,stop,target,...sized,feeBps,slippageBps,cost,status:'open',openedAt:new Date().toISOString(),mode:'paper-local'};savePosition(p);event({type:'open',symbol:p.symbol,side:p.side});return send(p,201);
      }
      if(url.pathname==='/api/paper/close'){const p=positions().find(x=>x.id===value.id&&x.status==='open');if(!p)throw Error('Position absente');const d=datasets.get(p.symbol);if(!exitFresh(d)||d.source!==p.source)throw Error('Prix actuel indisponible');finish(p,p.side==='BUY'?(d.quote.bid??d.quote.price):(d.quote.ask??d.quote.price),'Clôture manuelle');return send({ok:true});}
      return send({error:'Action inconnue'},404);
    }catch(e){return send({error:e.message},422);}
  });
  if(network){liveFeed=liveFeedFactory({
    onUpdate:update=>{if(stopping||!update.symbol)return;const d=datasets.get(update.symbol);if(!d||d.source!=='Kraken public · spot')return;
      if(update.quote){d.quote=update.quote;d.live=true;d.receivedAt=update.quote.localReceivedAt;delete feedErrors[update.symbol];signalFollowup.observe({symbol:update.symbol,source:d.source,quote:d.quote,fresh:exitFresh(d)});}
      if(update.currentBar)d.currentBar=update.currentBar;
    },
    onClosedBar:(symbol,bar)=>{const d=datasets.get(symbol);if(stopping||!d||d.source!=='Kraken public · spot')return;try{install({...d,bars:[...d.bars,bar]});}catch{feedErrors[symbol]='Bougie reçue non validée';}}
  });for(const d of datasets.values())if(d.source==='Kraken public · spot')liveFeed.seed(d.symbol,d);server.once('listening',()=>liveFeed.start());}
  if(network){derivFeed=derivFeedFactory({
    onHistory:d=>{if(stopping)return;try{install({...d,isRealtime:true,quality:{volumeAvailable:false,warning:'Volume consolidé indisponible pour ce flux'},provenance:{provider:'Deriv public',providerSymbol:DERIV_SYMBOLS[d.symbol]?.id,instrumentType:DERIV_SYMBOLS[d.symbol]?.market==='forex'?'Forex':'Gold spot broker quote',instrumentName:d.symbol,mode:'stream',isRealtime:true,fetchedAt:d.receivedAt,marketAsOf:d.quote?.receivedAt??d.bars.at(-1)?.time,marketTimezone:'UTC',providerDelaySeconds:null,marketOpen:derivFeed?.snapshot(d.symbol)?.marketOpen??null}});delete feedErrors[d.symbol];}catch{feedErrors[d.symbol]='Historique Deriv non validé';}},
    onUpdate:update=>{if(stopping||!update.symbol)return;const d=datasets.get(update.symbol);if(!d||d.source!==DERIV_SOURCE)return;if(update.quote){d.quote=update.quote;d.live=true;d.isRealtime=true;d.receivedAt=update.quote.localReceivedAt;d.staleAt=new Date(Date.parse(update.quote.receivedAt)+15000).toISOString();if(d.provenance){d.provenance.marketAsOf=update.quote.receivedAt;d.provenance.marketOpen=derivFeed?.snapshot(update.symbol)?.marketOpen??null;}delete feedErrors[update.symbol];signalFollowup.observe({symbol:update.symbol,source:d.source,quote:d.quote,fresh:exitFresh(d)});}if(update.currentBar)d.currentBar=update.currentBar;},
    onClosedBar:(symbol,bar)=>{const d=datasets.get(symbol);if(stopping||!d||d.source!==DERIV_SOURCE)return;try{install({...d,bars:[...d.bars,bar]});}catch{feedErrors[symbol]='Bougie Deriv non validée';}}
  });for(const d of datasets.values())if(d.source===DERIV_SOURCE)derivFeed.seed(d.symbol,d);server.once('listening',()=>derivFeed.start());}
  const timer=network?setInterval(()=>refresh().catch(()=>{}),60000):null;timer?.unref();
  if(network)server.once('listening',()=>newsService.start());
  const markTimer=setInterval(()=>{if(!stopping){mark();observeSignalLevels();observeSignals();}},1000);markTimer.unref();
  let closing=null;return {server,refresh,close:()=>closing??(closing=(async()=>{stopping=true;lifecycle.abort();if(timer)clearInterval(timer);clearInterval(markTimer);liveFeed?.stop();derivFeed?.stop();newsService.stop();for(const client of clients){removeClient(client);client.res.end();}clients.clear();await Promise.all([new Promise(resolve=>server.close(resolve)),modelPool.close()]);db.close();})())};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT??4328);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port invalide');const app=createApp({port});app.server.listen(port,'127.0.0.1',()=>{console.log('Orivane Funded : http://127.0.0.1:'+port);app.refresh().catch(()=>{});});for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await app.close();process.exit(0);});}
