import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createSyntheticMarketFixture} from '../../test/helpers/synthetic-market-fixture.mjs';

const publicRoot=new URL('../public/',import.meta.url),interval=900000;
function marketFixture(){const fixture=createSyntheticMarketFixture();return {...fixture,symbol:'BTC/USD',source:'Kraken public · spot'};}
function payloadFor(market,now,{skew=0,future=0}={}){
 const rows=market.bars.map(bar=>[Date.parse(bar.time)/1000,String(bar.open),String(bar.high),String(bar.low),String(bar.close),'0',String(bar.volume),1]);
 for(let i=0;i<=future;i++)rows.push([now/1000+i*900,'1000','1002','998','1001','0','100',1]);
 const price=market.bars.at(-1).close;
 return {receivedAt:new Date(now+skew).toISOString(),ohlc:{error:[],result:{XXBTZUSD:rows,last:now/1000}},
  ticker:{error:[],result:{XXBTZUSD:{c:[String(price)],b:[String(price-.1)],a:[String(price+.1)]}}}};
}

// Real browser modules run in a worker-like context without Node globals. Only
// network, cache and WebSocket transport are replaced; analytical modules are real.
async function environment({market=marketFixture(),payload,fetchFailure=false,noAbort=false,blockedCache=false}={}){
 let now=Date.parse(market.bars.at(-1).time)+interval;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 let source=await fs.readFile(new URL('mobile-engine.mjs',publicRoot),'utf8');const imports={};
 for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g)){
  const module=await import(new URL(match[2],publicRoot));
  for(const name of match[1].split(',').map(value=>value.trim())){const [original,local]=name.split(/\s+as\s+/);imports[local??original]=module[original];}
 }
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,'');
 class Socket{readyState=0;addEventListener(){}removeEventListener(){}close(){this.readyState=3;}send(){}}
 for(const name of ['KrakenLiveFeed','DerivLiveFeed','KrakenBookFeed']){
  const Base=imports[name];imports[name]=class extends Base{constructor(options){super({...options,WebSocketImpl:Socket});}};
 }
 imports.readHistory=blockedCache?()=>new Promise(()=>{}):async()=>[];
 imports.saveHistory=async()=>true;
 const normalize=imports.normalizeKrakenHistory;imports.normalizeKrakenHistory=value=>normalize(value,{now});
 const messages=[],calls=[],timers=new Set(),requestedDelays=[];
 const context=vm.createContext({...imports,Date:Clock,Map,Set,Math,JSON,Number,Array,Object,Promise,URL,Intl,crypto:webcrypto,
  ...(noAbort?{}:{AbortController}),
  setTimeout:(callback,delay)=>{requestedDelays.push(delay);const timer=setTimeout(callback,blockedCache&&delay===1500?0:delay);timers.add(timer);return timer;},clearTimeout,
  // Periodic maintenance is registered but never fired implicitly in these tests.
  setInterval:(callback,delay)=>{const marker={callback,delay};timers.add(marker);return marker;},clearInterval:()=>{},
  fetch:async(url,options)=>{calls.push({url:String(url),hasAbortSignal:Boolean(options?.signal)});
   if(String(url)==='/cloud/kraken'){
    if(fetchFailure)throw Error('Explicit test provider connection failure');
    return new Response(JSON.stringify(payload??payloadFor(market,now)),{status:200});
   }
   if(String(url)==='/models/index.json')return new Response(JSON.stringify({schemaVersion:1,models:[]}),{status:200});
   if(String(url)==='/cloud/news')return new Response(JSON.stringify({sources:[],items:[],receivedAt:new Date(now).toISOString()}),{status:200});
   return new Response('{}',{status:502});
  },postMessage:message=>messages.push(structuredClone(message))});
 context.self=context;vm.runInContext(source,context);
 return {context,messages,calls,requestedDelays,now:()=>now,advance:ms=>{now+=ms;},
  async drain(){for(let i=0;i<4;i++)await new Promise(setImmediate);},
  async init(saved){await context.onmessage({data:{type:'init',saved}});await this.drain();},
  state:()=>messages.filter(message=>message.type==='state').at(-1)?.state,
  close(){for(const timer of timers)if(typeof timer==='object'&&!('callback' in timer)||typeof timer==='number'){clearTimeout(timer);clearInterval(timer);}}};
}
const plain=value=>structuredClone(value);

test('device worker exposes actual mobile intelligence with PC off and preserves official HOLD confidence',async()=>{
 const market=marketFixture(),e=await environment({market});
 try{
  assert.equal(typeof e.context.require,'undefined');assert.equal(typeof e.context.Buffer,'undefined');
  await e.init();e.context.install(market);
  const state=await e.context.api('/api/state'),row=state.radar.find(value=>value.symbol==='BTC/USD');
  assert.equal(row.coverage,720);assert.equal(row.intelligence.status,'ready');assert.equal(row.intelligence.requiresPC,false);
  assert.equal(row.intelligence.regime.status,'estimated');assert.equal(row.intelligence.drift.status,'measured');
  assert.equal(row.intelligence.strategies.length,6);assert.equal(row.decision.side,'HOLD');assert.equal(row.decision.confidence.percent,null);
  assert.equal(row.intelligence.priceStrategies.length,16);assert.equal(row.intelligence.engineStrategies.length,66);
  const library=[...row.intelligence.engineStrategies,...row.intelligence.strategies,...row.intelligence.priceStrategies];
  assert.equal(new Set(library.map(rule=>rule.id)).size,88);
  assert.ok(row.intelligence.engineStrategies.some(rule=>rule.side==='HOLD'&&rule.directionalChecks.BUY.length>0));
  assert.ok(row.intelligence.engineStrategies.every(rule=>rule.formula&&rule.warmupBars>0));
  assert.equal(row.intelligence.strategyAnalysis.total,88);
  assert.equal(row.intelligence.strategyAnalysis.buy+row.intelligence.strategyAnalysis.sell+row.intelligence.strategyAnalysis.waiting+row.intelligence.strategyAnalysis.blocked,88);
  assert.deepEqual(plain(row.intelligence.marketAnalysis.frames.map(f=>f.minutes)),[15,60,240]);
  assert.ok(row.intelligence.strategies.every(strategy=>strategy.researchOnly&&!Object.hasOwn(strategy,'probability')&&!Object.hasOwn(strategy,'confidence')));
  const single=await e.context.api('/api/intelligence?symbol=BTC%2FUSD');assert.deepEqual(plain(single.intelligence),plain(row.intelligence));
  const all=await e.context.api('/api/intelligence');assert.equal(all.find(value=>value.symbol==='BTC/USD').intelligence.status,'ready');
  const runtime=await e.context.api('/api/runtime');assert.equal(runtime.onDevice,true);assert.equal(runtime.requiresPC,false);assert.equal(runtime.version,'intelligence-mobile3');
  assert.equal(e.calls.find(call=>call.url==='/cloud/kraken').hasAbortSignal,true);
  assert.ok(e.calls.every(call=>!call.url.includes('127.0.0.1')&&!call.url.includes('localhost')));
 }finally{e.close();}
});

test('ahead-of-device provider clock keeps real past history and exposes skew without shifting timestamps',async()=>{
 const market=marketFixture(),now=Date.parse(market.bars.at(-1).time)+interval,payload=payloadFor(market,now,{skew:3600000,future:2});
 const e=await environment({market,payload});
 try{
  await e.init();const state=await e.context.api('/api/state'),row=state.radar.find(value=>value.symbol==='BTC/USD');
  assert.equal(row.coverage,720);assert.equal(row.intelligence.status,'ready');assert.equal(row.provenance.clockSkewDetected,true);
  assert.equal(row.provenance.futureBarsRejected,3);assert.equal(row.provenance.clockOffsetMs,3600000);
  assert.match(row.connectionError,/horloges/);assert.equal(row.quote.receivedAt,new Date(now).toISOString());
  assert.equal(row.quote.serverReceivedAt,payload.receivedAt);assert.equal(row.provenance.localReceivedAt,new Date(now).toISOString());
  assert.equal(row.asOf,market.bars.at(-1).time);assert.ok(row.chartHistory.every(bar=>Date.parse(bar.time)+interval<=now));
  assert.equal(row.currentBar,null);assert.equal(row.live,false);assert.equal(row.decision.side,'HOLD');assert.equal(row.decision.confidence.percent,null);
 }finally{e.close();}
});

test('provider failures remain visible in device runtime and market state, including without AbortController',async()=>{
 const e=await environment({fetchFailure:true,noAbort:true});
 try{
  await e.init();const runtime=await e.context.api('/api/runtime'),state=await e.context.api('/api/state');
  assert.match(runtime.connectionErrors['BTC/USD'].message,/Explicit test provider connection failure/);
  assert.match(state.radar.find(row=>row.symbol==='BTC/USD').connectionError,/Explicit test provider connection failure/);
  assert.equal(state.radar.find(row=>row.symbol==='BTC/USD').decision.side,'HOLD');
  assert.equal(e.calls.find(call=>call.url==='/cloud/kraken').hasAbortSignal,false);
 }finally{e.close();}
});

test('resume refreshes cloud providers once per debounce window while preserving the device journal',async()=>{
 const market=marketFixture(),e=await environment({market});
 const position={id:'retained-journal-entry',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',
  status:'closed',mode:'paper-device',openedAt:'2025-01-01T00:00:00Z',closedAt:'2025-01-01T00:15:00Z',entry:100,stop:90,target:120,
  exit:105,pnl:5,quantity:1,netRisk:10,cost:{feeBps:0,slippageBps:0},reason:'Original stored journal'};
 try{
  await e.init({positions:[position],daily:{'2025-01-01':10000}});
  const before=plain(await e.context.api('/api/export')),count=route=>e.calls.filter(call=>call.url===route).length;
  const baseline={btc:count('/cloud/kraken'),nasdaq:count('/cloud/nasdaq')};
  await e.context.onmessage({data:{type:'resume'}});await e.drain();
  assert.equal(count('/cloud/kraken'),baseline.btc+1);assert.equal(count('/cloud/nasdaq'),baseline.nasdaq+1);
  const resumed=await e.context.api('/api/runtime');assert.equal(resumed.lastResumedAt,new Date(e.now()).toISOString());
  await e.context.onmessage({data:{type:'resume'}});await e.context.onmessage({data:{type:'resume'}});await e.drain();
  assert.equal(count('/cloud/kraken'),baseline.btc+1);assert.equal(count('/cloud/nasdaq'),baseline.nasdaq+1);
  const after=plain(await e.context.api('/api/export'));
  for(const key of ['profile','positions','history','followups','daily'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.positions[0].id,position.id);
  e.advance(5001);await e.context.onmessage({data:{type:'resume'}});await e.drain();
  assert.equal(count('/cloud/kraken'),baseline.btc+2);assert.equal((await e.context.api('/api/runtime')).lastResumedAt,new Date(e.now()).toISOString());
 }finally{e.close();}
});

test('a stuck historical cache cannot block independent provider initialization indefinitely',async()=>{
 const e=await environment({blockedCache:true});
 try{await e.init();assert.ok(e.requestedDelays.includes(1500));assert.ok(e.calls.some(call=>call.url==='/cloud/kraken'));
  assert.equal((await e.context.api('/api/state')).radar.find(row=>row.symbol==='BTC/USD').intelligence.status,'ready');
 }finally{e.close();}
});

test('deployed mobile module tree matches shared sources and built entry loads the new bridge version',async()=>{
for(const name of ['intelligence-ai.mjs','intelligence-strategies.mjs','mobile-intelligence.mjs','price-research.mjs','market-analysis.mjs','kraken-history.mjs']){
  const browser=await fs.readFile(new URL('core/'+name,publicRoot)),shared=await fs.readFile(new URL('../../src/'+name,import.meta.url));
  assert.equal(browser.equals(shared),true,`${name} browser copy differs from shared source`);
  assert.doesNotMatch(browser.toString(),/from\s+['"]node:/);
 }
 const engine=await fs.readFile(new URL('mobile-engine.mjs',publicRoot),'utf8');
 assert.match(engine,/buildMobileIntelligence/);assert.match(engine,/normalizeKrakenHistory/);
 const bridge=await fs.readFile(new URL('mobile-bridge.mjs',publicRoot),'utf8');
 assert.match(bridge,/mobile-engine\.mjs\?v=intelligence-mobile3/);assert.match(bridge,/mobile-model-worker\.mjs\?v=intelligence-mobile3/);
 const html=await fs.readFile(new URL('index.html',publicRoot),'utf8'),asset=html.match(/src="(\/terminal-ui\/assets\/index-[^"]+\.js)"/);
 assert.ok(asset,'Published index must load a built application entry');
 const bundle=await fs.readFile(new URL(asset[1].slice(1),publicRoot),'utf8');
 assert.ok(bundle.includes('/mobile-bridge.mjs?v=intelligence-mobile3'),'Built application must load the new on-device bridge');
});

test('missing volume blocks only affected rules and keeps price-only research inspectable',async()=>{
 const market=marketFixture();market.bars=market.bars.map(bar=>({...bar,volume:0,volumeUnavailable:true}));
 const e=await environment({market});
 try{
  await e.init();e.context.install(market);const row=(await e.context.api('/api/state')).radar.find(value=>value.symbol==='BTC/USD');
  assert.equal(row.intelligence.status,'insufficient');assert.equal(row.intelligence.reason,'real-volume-required');
  assert.equal(row.intelligence.priceStrategies.length,16);assert.ok(row.intelligence.priceStrategies.every(r=>r.dataReady));
  const blocked=row.intelligence.engineStrategies.filter(r=>r.volumeRequired);
  assert.ok(blocked.length>0);assert.ok(blocked.every(r=>r.dataReady===false&&r.side==='HOLD'&&r.entry===null));
  assert.ok(row.intelligence.engineStrategies.some(r=>!r.volumeRequired&&r.dataReady));
  assert.equal(row.intelligence.marketAnalysis.status,'ready');assert.equal(row.intelligence.strategyAnalysis.total,88);
  assert.equal(row.decision.side,'HOLD');
 }finally{e.close();}
});
