import test from 'node:test';
test('recent candle quality never labels unavailable data consecutive and hides cached quality on disconnect',()=>{
  const b=browser(),s=fixture(null);s.radar[0].decisionChecks={checks:[],reason:'Test',candleQuality:{status:'unavailable',scanned:0,reason:'Aucune bougie'}};
  b.state(s);assert.match(b.eval('decisionCheckRows(selected())'),/indisponible/);assert.doesNotMatch(b.eval('decisionCheckRows(selected())'),/consécutives/);
  s.radar[0].decisionChecks.candleQuality={status:'gaps',scanned:80,gaps:2,reason:'Données manquantes'};b.state(s);
  assert.match(b.eval('decisionCheckRows(selected())'),/2 interruptions/);b.disconnect();assert.doesNotMatch(b.eval('decisionCheckRows(selected())'),/80 bougies|2 interruptions/);
});
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import \{SignalAlertTracker\} from '\/signal-alerts\.js';\r?\n/,'');
const alerts=readFileSync(new URL('../public/signal-alerts.js',import.meta.url),'utf8').replace('export class SignalAlertTracker','class SignalAlertTracker');
const START=Date.parse('2026-10-08T14:01:00.000Z'),iso=t=>new Date(t).toISOString();

test('live signal checks explain simultaneous blocks and disappear on disconnect',()=>{
  const b=browser(),s=fixture(null);s.radar[0].decisionChecks={reason:'Objectif dépassé',checks:[{label:'Entrée et niveaux',status:'blocked',detail:'Objectif dépassé'},{label:'Tendance H1',status:'unavailable',detail:'Historique insuffisant'},{label:'Données actuelles',status:'passed',detail:'Direct'}]};
  b.state(s);const html=b.eval('decisionCheckRows(selected())');
  for(const text of ['Bloqué','Objectif dépassé','Historique insuffisant','✓'])assert.ok(html.includes(text));
  b.disconnect();assert.doesNotMatch(b.eval('decisionCheckRows(selected())'),/Objectif dépassé|✓/);
  assert.match(b.eval('decisionCheckRows(selected())'),/Connexion interrompue/);
});
function fixture(id='first',at=START){
  const event={id,type:'signal',mode:'observed-live',policy:'confidence-above-60-v1',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'pullback',strategyName:'Retest EMA',side:'BUY',confidencePercent:82.4,confidenceClass:'UP',signalTime:'2026-10-08T13:45:00.000Z',observedAt:iso(at),entry:100,stop:98,target:104};
  const result={token:'ui-test-token',account:{},signalPolicy:{id:event.policy},signalHistory:{mode:'observed-live',items:id?[event]:[]},radar:[{symbol:event.symbol,source:event.source,live:true,eligible:true,bars:[],signals:[],ideas:[],feed:{status:'live'},quote:{price:100,receivedAt:iso(at),transport:'websocket'},model:{status:'ready'},decision:{strategy:event.strategy,strategyName:event.strategyName,side:'BUY',closed:true,time:event.signalTime,entry:100,stop:98,target:104,confidence:{status:'estimate',class:'UP',percent:82.4,algorithm:'multinomial-logistic',classProbs:{UP:.824,DOWN:.1,FLAT:.076}}}}],marketHealth:[{symbol:event.symbol,source:event.source,state:'live',quoteAgeMs:500,spreadBps:12.7,modelStatus:'ready',quoteAt:iso(at),quoteEventAt:iso(at),lastClosedAt:event.signalTime,barCount:400,consecutiveClosedBars:200,formingBarProgressPct:35}],signalFollowup:{mode:'observed-levels',items:[]},profile:{confirmed:true},positions:[],strategyCatalog:[],news:{items:[]}};
  for(const symbol of ['EUR/USD','GBP/USD','XAU/USD','NDX'])result.radar.push({symbol,source:null,live:false,bars:[],signals:[],ideas:[],feed:{status:'unavailable'},decision:{side:'HOLD',closed:true,confidence:{status:'unavailable',percent:null,classProbs:null}}});
  return result;
}

function browser({saved=null,storageFailure=false}={}){
  let clock=START,socket,audioCount=0,resumes=0,tones=0,storage=saved;
  const listeners=new Map(),timers=[],elements=new Map();
  const element=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',hidden:true,disabled:false,querySelectorAll:()=>[],classList:{toggle(){}}});return elements.get(selector);};
  class ClockDate extends Date {static now(){return clock;}}
  class Socket {constructor(){socket=this;this.events={};}addEventListener(name,callback){this.events[name]=callback;}}
  class Audio {
    constructor(){audioCount++;this.state='running';this.currentTime=1;this.destination={};}
    resume(){resumes++;return Promise.resolve();}
    createOscillator(){tones++;return {frequency:{setValueAtTime(){}},connect(){},start(){},stop(){},disconnect(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const context=vm.createContext({Date:ClockDate,Intl,URL,console,window:{innerWidth:1000,AudioContext:Audio,addEventListener(){}},document:{querySelector:element,querySelectorAll:()=>[],addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);}},localStorage:{getItem(){if(storageFailure)throw Error('Storage disabled');return storage;},setItem(key,value){if(storageFailure)throw Error('Storage disabled');storage=value;}},EventSource:Socket,fetch:()=>new Promise(()=>{}),setTimeout:()=>1,setInterval:callback=>{timers.push(callback);return 1;}});
  vm.runInContext(alerts,context,{filename:'public/signal-alerts.js'});
  vm.runInContext(app,context,{filename:'public/app.js'});
  vm.runInContext("tab='sources'",context);
  return {context,element,eval:code=>vm.runInContext(code,context),state(value){socket.events.state({data:JSON.stringify(value)});},frame(data){socket.events.state({data});},disconnect(){socket.onerror();},open(){socket.onopen();},advance(ms){clock+=ms;},tick(){for(const callback of timers)callback();},async toggle(){const event={target:{closest:selector=>selector==='[data-alert-toggle]'?{}:null}};await Promise.all(listeners.get('click').map(callback=>callback(event)));},saved:()=>storage,audio:()=>({contexts:audioCount,resumes,tones})};
}

test('HOLD exposes the directional candidate probability instead of the neutral probability',()=>{
  const b=browser(),s=fixture(null),d=s.radar[0].decision;
  Object.assign(d,{side:'HOLD',entry:null,stop:null,target:null,confidenceGate:{candidateSide:'SELL',candidatePercent:43.7}});
  Object.assign(d.confidence,{class:'FLAT',percent:44.9,classProbs:{UP:.114,DOWN:.437,FLAT:.449}});
  b.state(s);const html=b.eval('signalCard(selected())');
  assert.match(html,/Candidat SELL/);assert.match(html,/43,7/);assert.doesNotMatch(html,/44,9|Probabilité neutre/);
  assert.match(html,/decision-side hold/);assert.match(html,/id="paper-open" disabled/);
  b.disconnect();assert.doesNotMatch(b.eval('signalCard(selected())'),/43,7|Candidat SELL/);
});

test('HOLD without a completed setup does not present FLAT as trading confidence',()=>{
  const b=browser(),s=fixture(null),d=s.radar[0].decision;
  Object.assign(d,{side:'HOLD',confidenceGate:{candidateSide:null,candidatePercent:null}});
  Object.assign(d.confidence,{class:'FLAT',percent:76.2});
  b.state(s);const html=b.eval('signalCard(selected())');
  assert.match(html,/Aucun déclencheur/);assert.doesNotMatch(html,/76,2|Candidat/);
});

test('unsupported model is named explicitly and its cached probabilities are not displayed',()=>{
  const b=browser(),s=fixture(null),d=s.radar[0].decision;
  Object.assign(d,{side:'HOLD',reason:'Modèle non retenu : aucune amélioration sur la référence'});
  Object.assign(d.confidence,{status:'unvalidated',percent:null,classProbs:null});
  b.state(s);
  assert.match(b.eval('signalCard(selected())'),/Modèle non retenu/);
  assert.equal(b.eval('aiStatusLabel(selected())'),'Modèle non retenu');
  assert.match(b.eval('aiScanRows()'),/Non retenu/);
  assert.doesNotMatch(b.eval('aiProbabilities(selected())'),/82,4/);
});

test('replay UI labels historical outcomes and keeps them separate from live confidence',()=>{
  const b=browser(),s=fixture(null);
  s.radar[0].replay={status:'insufficient',metrics:{n:1,winRate:0,expectancy:-1.1,totalR:-1.1},counts:{noSetup:8,confidence:5,h1:3,levels:1,price:2,costs:0,censored:1},reason:'Moins de 20 trades clôturés dans ce replay',horizonBars:4,modelCalibratedThrough:iso(START-86400000),assumptions:['Spread historique indisponible'],recentTrades:[{time:iso(START-3600000),side:'SELL',r:-1.1,reason:'Stop'}]};
  b.state(s);const html=b.eval('replayDetails(selected())');
  for(const text of ['Moteur complet','Gagnants historiques','Spread historique indisponible','Stop','Issues non connues'])assert.ok(html.includes(text),text);
  assert.equal(b.eval('replayLabel(selected())'),'1 trades simulés');
  assert.match(b.eval('signalCard(selected())'),/82,4/);assert.doesNotMatch(html,/82,4/);
  assert.match(b.eval('aiPanel(selected())'),/Replay du moteur/);
});

test('persisted alert activation starts with a silent baseline and remembers every new event',()=>{
  const b=browser({saved:JSON.stringify({enabled:true,seenIds:[]})});
  b.state(fixture());assert.equal(b.element('#notice').textContent,'');assert.deepEqual(b.audio(),{contexts:0,resumes:0,tones:0});
  b.advance(1000);b.state(fixture('second',START+1000));
  assert.match(b.element('#notice').textContent,/BTC\/USD · BUY · 82,4 %/);
  assert.deepEqual(JSON.parse(b.saved()).seenIds,['first','second']);
  b.element('#notice').textContent='unchanged';b.state(fixture('second',START+1000));assert.equal(b.element('#notice').textContent,'unchanged');
});

test('only user activation initializes audio; disabling consumes events without replay',async()=>{
  const b=browser();b.state(fixture());assert.match(b.eval('alertButton()'),/Alertes off/);
  await b.toggle();assert.deepEqual(b.audio(),{contexts:1,resumes:1,tones:0});assert.equal(JSON.parse(b.saved()).enabled,true);
  b.advance(1000);b.state(fixture('second',START+1000));assert.equal(b.audio().tones,1);
  await b.toggle();assert.equal(JSON.parse(b.saved()).enabled,false);
  b.advance(1000);b.state(fixture('third',START+2000));assert.equal(b.audio().tones,1);
  await b.toggle();b.state(fixture('third',START+2000));assert.equal(b.audio().tones,1);
  b.advance(1000);b.state(fixture('fourth',START+3000));assert.equal(b.audio().tones,2);
});

test('reloading saved settings and deduplication IDs cannot alert the same live event again',()=>{
  const first=browser({saved:JSON.stringify({enabled:true,seenIds:[]})});first.state(fixture());
  first.advance(1000);first.state(fixture('second',START+1000));
  const restarted=browser({saved:first.saved()});restarted.state(fixture(null));restarted.advance(1000);restarted.state(fixture('second',START+1000));
  assert.equal(restarted.element('#notice').textContent,'');assert.match(restarted.eval('alertButton()'),/Alertes on/);
});

test('storage parsing and denied persistence fail safely without requiring browser permission',async()=>{
  for(const options of [{saved:'not-json'},{saved:'null'},{storageFailure:true}]){
    const b=browser(options);b.state(fixture());assert.match(b.eval('alertButton()'),/Alertes off/);
    await b.toggle();assert.match(b.eval('alertButton()'),/Alertes on/);
  }
});

test('SSE disconnect immediately masks probability, quote age, spread and forming progress',()=>{
  const b=browser();b.state(fixture());assert.match(b.eval('aiProbabilities(selected())'),/82,4/);assert.match(b.eval('healthRows()'),/12,7 pb/);
  b.disconnect();assert.equal(b.eval('pushFresh()'),false);assert.doesNotMatch(b.eval('aiProbabilities(selected())'),/82,4/);
  assert.equal(b.eval('healthSummary()'),'Reconnexion…');assert.match(b.eval('healthRows()'),/Déconnecté/);assert.doesNotMatch(b.eval('healthRows()'),/12,7 pb/);
  assert.equal(b.eval('formingProgress(selected())'),'');assert.equal(b.element('#paper-open').disabled,true);
});

test('five seconds without a valid SSE frame masks cached confidence and pauses browser alerts',()=>{
  const b=browser({saved:JSON.stringify({enabled:true})});b.state(fixture());b.advance(5000);b.tick();
  assert.equal(b.eval('pushFresh()'),false);assert.doesNotMatch(b.eval('aiProbabilities(selected())'),/82,4/);
  assert.match(b.element('#health-rows').innerHTML,/Déconnecté/);
});

test('reopening SSE waits for a new valid state before reviving cached BUY probabilities',()=>{
  const b=browser();b.state(fixture());b.advance(1000);b.disconnect();b.open();
  assert.equal(b.eval('pushFresh()'),false);assert.doesNotMatch(b.eval('aiProbabilities(selected())'),/82,4/);
  b.state(fixture(null,START+1000));assert.equal(b.eval('pushFresh()'),true);assert.match(b.eval('aiProbabilities(selected())'),/82,4/);
});

test('malformed SSE frames cannot refresh cached BUY confidence or replace the accepted state',()=>{
  const b=browser();b.state(fixture());b.advance(1000);b.frame('not-json');
  assert.equal(b.eval('pushFresh()'),false);assert.doesNotMatch(b.eval('aiProbabilities(selected())'),/82,4/);
  assert.match(b.element('#notice').textContent,/invalide/);
  b.frame('{}');assert.equal(b.eval('pushFresh()'),false);assert.equal(b.eval('selected().symbol'),'BTC/USD');
});

test('follow-up labels stay tied to observed prices and exclude outcomes from other markets',()=>{
  const b=browser(),state=fixture(null),common={symbol:'BTC/USD',side:'BUY',confidencePercent:82.4,strategy:'pullback',strategyName:'Retest EMA',entry:100,stop:98,target:104,signalObservedAt:iso(START),horizonEndAt:iso(START+3600000)};
  state.signalFollowup.items=[{...common,status:'watching',observedPrice:null},{...common,status:'target-observed',observedPrice:104.5,observedAt:iso(START+1000)},{...common,status:'stop-observed',observedPrice:97.9,observedAt:iso(START+2000)},{...common,status:'expired',observedPrice:null},{...common,symbol:'XAU/USD',strategyName:'OTHER MARKET',status:'target-observed',observedPrice:999}];
  b.state(state);const html=b.eval('followupRows(selected())');
  for(const label of ['En observation','Objectif observé','Stop observé','Horizon terminé','104,50','97,90'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/OTHER MARKET|999|win rate|PnL/i);assert.equal(b.eval('followupLabel(selected())'),'1 en observation');
  assert.match(b.eval('technologyPanel(selected())'),/distincts des trades paper/);
});
