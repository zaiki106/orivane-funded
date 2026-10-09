import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';import {createApp,validateProfile,defaultProfile} from '../src/server.mjs';
import {signal,indicators} from '../src/engine.mjs';
import {classes,featureNames,decisionVersion,featureWindow,signalPolicy} from '../src/decision.mjs';
const noDerivFeed=()=>({seed(){},start(){},stop(){},snapshot:()=>({status:'disabled'})});
const noNewsService=()=>({start(){},stop(){},snapshot:()=>({status:'unavailable',items:[],sources:[],updatedAt:null,lastAttemptAt:null,nextRefreshAt:null,ageMs:null,refreshMs:300000})});
function fixedProbabilityModel(dataset,p=[.8,.1,.1]){
  return {version:decisionVersion,symbol:dataset.symbol,source:dataset.source,classes:[...classes],featureWindow,status:'estimate',calibrated:true,audited:true,test:{sample:100,brier:.4,baselineBrier:.5},
    calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,
    weights:p.map(value=>[Math.log(value),...Array(featureNames.length).fill(0)]),
    scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)},
    event:{kind:'market_class_probability',description:'Direction nette à 60 min',horizonBars:4,horizonMinutes:60}};
}
const fixedModelPool=(p=[.8,.1,.1])=>options=>({schedule:(dataset,version)=>options.onCalibration({symbol:dataset.symbol,source:dataset.source,version,calibration:fixedProbabilityModel(dataset,p),trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});

test('public state, ideas and paper orders reject a high probability model without improvement on reference',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:(i===99?104:100)+1,low:99,close:i===99?104:100,volume:i===99?200:100}));
  const fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  const pool=options=>({schedule:(d,version)=>options.onCalibration({symbol:d.symbol,source:d.source,version,calibration:{...fixedProbabilityModel(d),test:{sample:100,brier:.6,baselineBrier:.5}},trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],importsPath:'',modelPoolFactory:pool});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const state=await fetch(base+'/api/state').then(r=>r.json()),m=state.radar[0];
    assert.equal(m.decision.side,'HOLD');assert.equal(m.decision.modelAssessment.status,'no-edge');
    assert.equal(m.decision.confidence.percent,null);assert.equal(m.decision.confidence.classProbs,null);
    assert.ok(m.ideas.every(i=>!i.confirmed&&i.stop===null&&i.target===null));
    const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(body)});
    assert.equal((await post('/api/profile',{...defaultProfile,confirmed:true})).status,200);
    const order=await post('/api/paper/open',{symbol:'BTC/USD',strategy:m.decision.strategy});
    assert.equal(order.status,422);assert.match((await order.json()).error,/référence/);
    const after=await fetch(base+'/api/state').then(r=>r.json());assert.deepEqual(after.positions,[]);assert.deepEqual(after.signalHistory.items,[]);
  }finally{await app.close();}
});
test('radar keeps exactly five requested markets with unavailable placeholders and no proxy substitutions',async()=>{
  const app=createApp({dbPath:':memory:',network:false,importsPath:path.join(tmpdir(),'orivane-no-imports')});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json());
    assert.deepEqual(state.radar.map(m=>m.symbol),['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX']);
    for(const row of state.radar.filter(m=>m.symbol!=='BTC/USD')){assert.deepEqual(row.bars,[]);assert.equal(row.quote,null);assert.equal(row.decision.side,'HOLD');assert.equal(row.decision.confidence.percent,null);assert.equal(row.feed.status,'unavailable');}
    const diagnostics=await fetch(base+'/api/model').then(response=>response.json());assert.equal(diagnostics.markets.length,5);assert.equal(diagnostics.jobs.concurrency,2);assert.ok(diagnostics.markets.every(m=>!('weights'in m)&&!('scaler'in m)));
    assert.equal(validateProfile({...defaultProfile,allowedSymbols:['NDX','QQQ']}).allowedSymbols[0],'NDX');
  }finally{await app.close();}
});
test('forming-candle strategy previews are provisional and cannot open a paper trade before closed-bar confirmation',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:100.1,low:99.9,close:100,volume:10})),currentBar={time:new Date(begin).toISOString(),open:100,high:101.1,low:99.9,close:101,volume:100,closed:false,source:'Deterministic test feed'},fixture={symbol:'BTC/USD',source:'Deterministic test feed',timeframe:15,live:true,bars,currentBar,quote:{price:101,receivedAt:new Date().toISOString()}};
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture]});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const state=await fetch(base+'/api/state').then(r=>r.json()),market=state.radar.find(row=>row.symbol==='BTC/USD');
    assert.equal(market.signals.find(s=>s.strategy==='breakout').side,'HOLD');
    const preview=market.previewSignals.find(s=>s.strategy==='breakout');assert.equal(preview.side,'BUY');assert.equal(preview.provisional,true);assert.equal(preview.closed,false);
    assert.ok(market.bars.every(bar=>bar.time!==currentBar.time));assert.equal(market.currentBar.time,currentBar.time);
    const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});
    await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']});
    const response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:'breakout'});assert.equal(response.status,422);assert.match((await response.json()).error,/Déclencheur|Décision confirmée/);
  }finally{await app.close();}
});
test('state stream pushes the API contract automatically and releases its connection on shutdown',async()=>{
  const app=createApp({dbPath:':memory:',network:false});const controller=new AbortController();let reader;
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+app.server.address().port;
    const initial=await fetch(base+'/api/state').then(r=>r.json());
    const response=await fetch(base+'/api/stream',{signal:controller.signal});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',events=[];const times=[];
    while(events.length<6){const {value,done}=await reader.read();assert.equal(done,false);buffer+=decoder.decode(value,{stream:true});
      let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        if(block.startsWith('event: state\ndata: ')){events.push(JSON.parse(block.slice('event: state\ndata: '.length)));times.push(Date.now());}
      }
    }
    assert.equal(events[0].token,initial.token);assert.equal(events[0].stream.status,'disabled');
    assert.ok(events[0].radar.every(row=>Array.isArray(row.previewSignals)&&Array.isArray(row.signals)&&row.timeframe===15));
    const intervals=times.slice(1).map((time,index)=>time-times[index]);
    assert.ok(intervals.every(interval=>interval>=900&&interval<1750),'State pushes must stay nominally 1 Hz without skipped seconds: '+intervals.join(','));
    await reader.cancel();reader=null;await app.close();
  }finally{controller.abort();await reader?.cancel().catch(()=>{});await app.close();}
});
test('a recent Kraken quote cannot authorize an order during reconnection or when closed-bar history is stale',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'orivane-stream-test-')),begin=Math.floor(Date.now()/900000)*900000;
  const makeBars=shift=>Array.from({length:100},(_,i)=>{const close=100+i*.1+(i===99?1:0);return {time:new Date(begin-(100-i+shift)*900000).toISOString(),open:close-(i===99?.8:.05),high:close+(i===99?.2:.02),low:close-(i===99?.85:.08),close,volume:i===99?100:10};});
  let transportStatus='reconnecting';const bars=makeBars(0),fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:bars.at(-1).close,receivedAt:new Date().toISOString(),transport:'websocket'}};
  const factory=options=>({seed(){},start(){options.onUpdate({type:'quote',symbol:'BTC/USD',quote:{...fixture.quote,receivedAt:new Date().toISOString(),localReceivedAt:new Date().toISOString()}});},stop(){},snapshot(symbol){return {status:transportStatus,provider:'Kraken WebSocket v2',transport:'websocket',currentBar:null,ageMs:0,lastEventAt:new Date().toISOString()};}});
  let app=createApp({dbPath:path.join(dir,'fresh.sqlite'),network:true,initialDatasets:[fixture],liveFeedFactory:factory,derivFeedFactory:noDerivFeed,newsServiceFactory:noNewsService,importsPath:path.join(dir,'no-imports')});
  try{
    async function client(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(r=>r.json()),post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']});return {state,post};}
    let {state,post}=await client();assert.equal(state.radar.find(row=>row.symbol==='BTC/USD').quote.price,fixture.quote.price);
    assert.equal(state.sources.find(source=>source.name==='Kraken').status,'Reconnexion en cours');
    let response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:'breakout'});assert.equal(response.status,422);assert.match((await response.json()).error,/flux confirmé/);
    transportStatus='live';response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:'breakout'});assert.equal(response.status,422);assert.match((await response.json()).error,/décision confirmée|stratégie différente/i);
    await app.close();
    app=createApp({dbPath:path.join(dir,'stale','test.sqlite'),network:true,initialDatasets:[{...fixture,bars:makeBars(2),quote:{...fixture.quote,receivedAt:new Date().toISOString()}}],liveFeedFactory:factory,derivFeedFactory:noDerivFeed,newsServiceFactory:noNewsService,importsPath:path.join(dir,'no-imports')});
    ({post}=await client());response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:'breakout'});assert.equal(response.status,422);assert.match((await response.json()).error,/flux confirmé/);
  }finally{await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'orivane-stream-test-'));rmSync(dir,{recursive:true,force:true});}
});

test('snapshot prices stay non-executable and pending models expose no fabricated confidence',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0})),fixture={symbol:'EUR/USD',source:'Real provider snapshot fixture',timeframe:15,live:false,isRealtime:false,bars,quote:{price:100,receivedAt:new Date().toISOString(),transport:'import'},provenance:{provider:'Test provider',mode:'snapshot',isRealtime:false,providerSymbol:'EURUSD=X'}};
  const pendingPool=()=>({schedule(){},snapshot:()=>({active:0,queued:1,concurrency:2}),close:async()=>{}});
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory:pendingPool});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='EUR/USD');
    assert.equal(market.live,false);assert.equal(market.feed.status,'snapshot');assert.equal(market.decision.dataMode,'snapshot');assert.equal(market.decision.side,'HOLD');assert.equal(market.decision.confidence.percent,null);assert.equal(market.model.status,'pending');assert.equal(market.provenance.providerSymbol,'EURUSD=X');
    const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['EUR/USD']});assert.equal((await post('/api/paper/open',{symbol:'EUR/USD',strategy:'breakout'})).status,422);
  }finally{await app.close();}
});

test('obsolete source model results are ignored while fresh source results replace pending status',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0})),fixture={symbol:'EUR/USD',source:'First provider',timeframe:15,live:false,bars,quote:null};
  let callbacks;const jobs=[];const poolFactory=options=>{callbacks=options;return {schedule:(dataset,version)=>jobs.push({dataset,version}),snapshot:()=>({active:0,queued:jobs.length,concurrency:2}),close:async()=>{}};};
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory:poolFactory,importsPath:path.join(tmpdir(),'orivane-no-imports')});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,job=jobs.find(j=>j.dataset.symbol==='EUR/USD');
    callbacks.onResult({symbol:'EUR/USD',version:job.version,source:'Wrong provider',laboratory:{symbol:'EUR/USD',results:[]},calibration:null,trainedAt:new Date().toISOString()});
    let state=await fetch(base+'/api/state').then(response=>response.json());assert.equal(state.radar.find(m=>m.symbol==='EUR/USD').model.status,'pending');
    callbacks.onResult({symbol:'EUR/USD',version:job.version,source:'First provider',laboratory:{symbol:'EUR/USD',results:[]},calibration:null,trainedAt:new Date().toISOString()});
    state=await fetch(base+'/api/state').then(response=>response.json());assert.equal(state.radar.find(m=>m.symbol==='EUR/USD').model.status,'ready');
  }finally{await app.close();}
});

test('a protective paper stop uses a fresh observed quote even when candle history is delayed',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'orivane-stop-test-')),dbPath=path.join(directory,'test.sqlite'),begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>{const close=100+i*.1+(i===99?1:0);return {time:new Date(begin-(100-i)*900000).toISOString(),open:close-(i===99?.8:.05),high:close+(i===99?.2:.02),low:close-(i===99?.85:.08),close,volume:i===99?100:10};}),fixture={symbol:'BTC/USD',source:'Observed quote fixture',timeframe:15,live:true,bars,quote:{price:bars.at(-1).close,receivedAt:new Date().toISOString()}};
  let app=createApp({dbPath,network:false,initialDatasets:[fixture],modelPoolFactory:fixedModelPool(),importsPath:path.join(directory,'no-imports')});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));let base='http://127.0.0.1:'+app.server.address().port;
    const state=await fetch(base+'/api/state').then(response=>response.json()),post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});
    await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']});assert.equal(state.radar[0].decision.strategy,'donchian55');const response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:state.radar[0].decision.strategy});assert.equal(response.status,201);const position=await response.json();await app.close();
    const delayedBars=bars.map(bar=>({...bar,time:new Date(Date.parse(bar.time)-1800000).toISOString()}));
    app=createApp({dbPath,network:false,initialDatasets:[{...fixture,bars:delayedBars,quote:{price:position.stop*.99,receivedAt:new Date().toISOString()}}],importsPath:path.join(directory,'no-imports')});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;
    await new Promise(resolve=>setTimeout(resolve,1150));const after=await fetch(base+'/api/state').then(result=>result.json());assert.equal(after.radar[0].decision.confidence.percent,null);assert.equal(after.positions[0].status,'closed');assert.equal(after.positions[0].reason,'Stop observé');assert.ok(after.positions[0].pnl<0);
  }finally{await app.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'orivane-stop-test-'));rmSync(directory,{recursive:true,force:true});}
});
test('news and conditional ideas have separate API contracts without synthetic historical signal records',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0})),fixture={symbol:'EUR/USD',source:'Provider snapshot fixture',timeframe:15,live:false,isRealtime:false,bars,quote:{price:100,receivedAt:new Date().toISOString(),transport:'import'}};
  let stopped=false;const article={id:'official-fixture',title:'Published central bank statement',url:'https://www.federalreserve.gov/newsevents/pressreleases.htm',source:'Federal Reserve',sourceId:'fed',sourceKind:'official',publishedAt:new Date(begin).toISOString(),receivedAt:new Date().toISOString(),symbols:['EUR/USD'],category:'monetary-policy',cached:false,stale:false};
  const newsServiceFactory=()=>({start(){},stop(){stopped=true;},snapshot(symbol){return {status:'ready',items:!symbol||article.symbols.includes(symbol)?[article]:[],sources:[{id:'fed',status:'ready'}],updatedAt:article.receivedAt,lastAttemptAt:article.receivedAt,nextRefreshAt:null,ageMs:0,refreshMs:300000};}});
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],newsServiceFactory,importsPath:path.join(tmpdir(),'orivane-no-imports')});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='EUR/USD');
    assert.equal(state.strategyCatalog.length,42);assert.equal(state.news.items[0].url,article.url);assert.equal(market.ideas.length,3);assert.ok(market.ideas.every(idea=>idea.source===fixture.source&&!idea.live&&!('confidence'in idea)));assert.equal(market.holdReason.lastClosedAt,new Date(begin).toISOString());
    assert.deepEqual(await fetch(base+'/api/news?symbol=EUR%2FUSD').then(response=>response.json()),state.news);assert.deepEqual((await fetch(base+'/api/news?symbol=BTC%2FUSD').then(response=>response.json())).items,[]);
    const ideas=await fetch(base+'/api/ideas?symbol=EUR%2FUSD').then(response=>response.json());assert.equal(ideas.symbol,'EUR/USD');assert.deepEqual(ideas.items.map(idea=>idea.id),market.ideas.map(idea=>idea.id));
    const history=await fetch(base+'/api/signals').then(response=>response.json());assert.equal(history.mode,'observed-live');assert.deepEqual(history.items,[]);assert.deepEqual(state.signalHistory.items,[]);
    for(const route of ['/api/news','/api/ideas','/api/signals'])assert.equal((await fetch(base+route+'?symbol=QQQ')).status,400);
  }finally{await app.close();assert.equal(stopped,true);}
});

test('closed Nasdaq market forces HOLD and no active ideas even with recent genuine snapshots and ready model',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>{const close=i===99?104:100;return {time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:close+1,low:99,close,volume:i===99?200:100};}),fixture={symbol:'NDX',source:'True index snapshot fixture',timeframe:15,live:false,isRealtime:false,bars,quote:{price:104,receivedAt:new Date().toISOString()},provenance:{providerSymbol:'^NDX',mode:'snapshot',marketOpen:false,isRealtime:false}};
  const modelPoolFactory=options=>({schedule:(dataset,version)=>options.onCalibration({symbol:dataset.symbol,source:dataset.source,version,calibration:null,trainedAt:new Date().toISOString()}),snapshot:()=>({active:0,queued:0,concurrency:2}),close:async()=>{}});
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory,importsPath:path.join(tmpdir(),'orivane-no-imports')});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const state=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='NDX');
    assert.equal(market.model.status,'ready');assert.equal(market.feed.status,'closed');assert.equal(market.live,false);assert.equal(market.decision.side,'HOLD');assert.equal(market.decision.reason,'Marché fermé');assert.equal(market.decision.confidence.percent,null);assert.equal(market.holdReason.nextCloseAt,null);assert.deepEqual(market.ideas,[]);
  }finally{await app.close();}
});

test('catalogue checks and provisional previews use exactly the router indicator window',async()=>{
  const begin=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:300},(_,i)=>{const close=i<180?500:100+Math.sin(i)*.5;return {time:new Date(begin-(300-i)*900000).toISOString(),open:close,high:close+1,low:close-1,close,volume:100};}),currentBar={time:new Date(begin).toISOString(),open:100,high:102,low:99,close:101,volume:100,closed:false},fixture={symbol:'EUR/USD',source:'Window fixture',timeframe:15,live:true,bars,currentBar,quote:{price:101,receivedAt:new Date().toISOString()}};
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],importsPath:path.join(tmpdir(),'orivane-no-imports')});
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const state=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='EUR/USD');
    for(const actual of market.signals){const expected=signal(bars.slice(-160),actual.strategy);assert.deepEqual(actual.directionalChecks,expected.directionalChecks);assert.equal(actual.stop,expected.stop);}
    const previewBars=[...bars,currentBar].slice(-160),previewContext=indicators(previewBars,{includeForming:true});
    for(const actual of market.previewSignals){const expected=signal(previewBars,actual.strategy,previewContext);assert.deepEqual(actual.directionalChecks,expected.directionalChecks);assert.equal(actual.stop,expected.stop);assert.equal(actual.time,currentBar.time);assert.equal(actual.closed,false);}
  }finally{await app.close();}
});

test('actual live confirmed transitions are recorded once and persist without retrospective backfill',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'orivane-signal-test-')),dbPath=path.join(directory,'test.sqlite'),begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>{const close=i===99?104:100;return {time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:close+1,low:99,close,volume:i===99?200:100};}),fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  const liveFeedFactory=options=>({seed(){},start(){options.onUpdate({symbol:'BTC/USD',quote:{...fixture.quote,receivedAt:new Date().toISOString(),localReceivedAt:new Date().toISOString()}});},stop(){},snapshot:()=>({status:'live',provider:'Kraken WebSocket v2',transport:'websocket',ageMs:0,currentBar:null})}),
    modelPoolFactory=fixedModelPool(),
    create=()=>createApp({dbPath,network:true,initialDatasets:[fixture],liveFeedFactory,derivFeedFactory:noDerivFeed,newsServiceFactory:noNewsService,modelPoolFactory,importsPath:path.join(directory,'no-imports')});
  let app=create();
  try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));let base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json());assert.equal(state.radar[0].decision.side,'BUY');assert.deepEqual(state.signalHistory.items,[]);
    await new Promise(resolve=>setTimeout(resolve,2150));let history=await fetch(base+'/api/signals?symbol=BTC%2FUSD').then(response=>response.json());assert.equal(history.items.length,1);const record=history.items[0];assert.equal(record.mode,'observed-live');assert.equal(record.side,'BUY');assert.equal(record.source,fixture.source);assert.equal(record.quotePrice,104);assert.equal(record.signalTime,bars.at(-1).time);assert.ok(Date.parse(record.observedAt)>Date.parse(record.signalTime));assert.equal(record.confidencePercent,80);assert.equal(record.confidenceClass,'UP');assert.equal(record.policy,signalPolicy.id);assert.equal((await fetch(base+'/api/signals?symbol=EUR%2FUSD').then(response=>response.json())).items.length,0);
    await app.close();app=create();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;await new Promise(resolve=>setTimeout(resolve,1150));history=await fetch(base+'/api/signals').then(response=>response.json());assert.equal(history.items.length,1);assert.equal(history.items[0].id,record.id);
  }finally{await app.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'orivane-signal-test-'));rmSync(directory,{recursive:true,force:true});}
});
test('direction confidence at 7 percent or a published 60 percent cannot confirm, record or open an entry in either network mode',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'orivane-confidence-test-')),begin=Math.floor(Date.now()/900000)*900000;
  const bars=Array.from({length:100},(_,i)=>{const close=i===99?104:100;return {time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:close+1,low:99,close,volume:i===99?200:100};}),fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,live:true,bars,quote:{price:104,receivedAt:new Date().toISOString(),transport:'websocket'}};
  assert.equal(signal(bars,'breakout').side,'BUY','A real technical trigger must exist so only confidence can block the entry');
  const liveFeedFactory=options=>({seed(){},start(){options.onUpdate({symbol:'BTC/USD',quote:{...fixture.quote,receivedAt:new Date().toISOString(),localReceivedAt:new Date().toISOString()}});},stop(){},snapshot:()=>({status:'live',provider:'Kraken WebSocket v2',transport:'websocket',ageMs:0,currentBar:null})});
  try{for(const network of [false,true])for(const [probabilities,publishedPercent] of [[[.07,.13,.8],7],[[.6,.1,.3],60],[[.6004,.1,.2996],60]]){
    const app=createApp({dbPath:path.join(directory,network+'-'+publishedPercent+'-'+probabilities[0]+'.sqlite'),network,initialDatasets:[fixture],liveFeedFactory,derivFeedFactory:noDerivFeed,newsServiceFactory:noNewsService,modelPoolFactory:fixedModelPool(probabilities),importsPath:path.join(directory,'no-imports')});
    try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(response=>response.json()),market=state.radar.find(row=>row.symbol==='BTC/USD'),decision=market.decision;
      assert.equal(market.live,true);assert.equal(market.model.status,'ready');assert.equal(decision.side,'HOLD');assert.equal(market.signal.side,'HOLD');assert.equal(decision.filteredByConfidence,true);assert.equal(decision.confidence.kind,'market_class_probability');assert.equal(decision.confidenceGate.candidateSide,'BUY');assert.equal(decision.confidenceGate.candidatePercent,publishedPercent);assert.equal(decision.confidenceGate.minimumPercent,60);assert.equal(decision.confidenceGate.comparison,'>');assert.equal(decision.confidenceGate.passed,false);assert.equal(decision.setup.confirmed,false);assert.equal(decision.setup.entry,null);
      assert.ok(market.ideas.length>0&&market.ideas.every(idea=>!idea.confirmed&&idea.status!=='confirmed'));assert.deepEqual(state.signalHistory.items,[]);
      const ideas=await fetch(base+'/api/ideas?symbol=BTC%2FUSD').then(response=>response.json());assert.ok(ideas.items.every(idea=>!idea.confirmed));
      const post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});assert.equal((await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']})).status,200);
      const response=await post('/api/paper/open',{symbol:'BTC/USD',strategy:'breakout'});assert.equal(response.status,422);assert.equal((await fetch(base+'/api/state').then(result=>result.json())).positions.length,0);
      if(network)await new Promise(resolve=>setTimeout(resolve,1150));const history=await fetch(base+'/api/signals?symbol=BTC%2FUSD').then(result=>result.json());assert.deepEqual(history.items,[]);
    }finally{await app.close();}
  }}finally{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'orivane-confidence-test-'));rmSync(directory,{recursive:true,force:true});}
});
test('profile rejects inconsistent, unknown or invalid risk configuration',()=>{assert.throws(()=>validateProfile({...defaultProfile,riskPercent:2}));assert.throws(()=>validateProfile({...defaultProfile,minDays:1.5}));assert.throws(()=>validateProfile({...defaultProfile,allowedSymbols:['SCAM']}));assert.throws(()=>validateProfile({...defaultProfile,resetTimezone:'Invalid'}));assert.equal(validateProfile({...defaultProfile,minDays:4}).minDays,4);});
test('paper lifecycle opens once above 60 percent at current price and closes persistently with costs',async()=>{
  const now=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:100},(_,i)=>{const close=100+i*.1+(i===99?1:0);return {time:new Date(now-(100-i)*900000).toISOString(),open:close-(i===99?.8:.05),high:close+(i===99?.2:.02),low:close-(i===99?.85:.08),close,volume:i===99?100:10};}),fixture={symbol:'BTC/USD',source:'Deterministic test feed',live:true,bars,quote:{price:bars.at(-1).close,receivedAt:new Date().toISOString()}};
  const app=createApp({dbPath:':memory:',network:false,initialDatasets:[fixture],modelPoolFactory:fixedModelPool()});
  try{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,state=await fetch(base+'/api/state').then(r=>r.json()),post=(url,value)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify(value)});
    assert.equal(state.radar[0].decision.side,'BUY');assert.equal(state.radar[0].decision.confidence.percent,80);
    assert.equal(state.radar[0].decision.strategy,'donchian55');assert.equal((await post('/api/profile',{...defaultProfile,confirmed:true,allowedSymbols:['BTC/USD']})).status,200);const opened=await post('/api/paper/open',{symbol:'BTC/USD',strategy:state.radar[0].decision.strategy});assert.equal(opened.status,201,JSON.stringify(await opened.clone().json()));const p=await opened.json();assert.equal(p.mode,'paper-local');assert.ok(p.quantity>0&&p.notional<=100000);assert.equal((await post('/api/paper/open',{symbol:'BTC/USD',strategy:state.radar[0].decision.strategy})).status,422);assert.equal((await post('/api/profile',{...defaultProfile,capital:50000,confirmed:true,allowedSymbols:['BTC/USD']})).status,422);assert.equal((await post('/api/paper/close',{id:p.id})).status,200);const current=await fetch(base+'/api/state').then(r=>r.json());assert.equal(current.positions[0].status,'closed');assert.ok(current.positions[0].pnl<0);assert.equal(current.account.tradingDays,1);assert.equal((await post('/api/paper/close',{id:p.id})).status,422);
  }finally{await app.close();}
});
test('terminal persists settings, rejects CSRF, stale orders and foreign hosts',async()=>{const dir=mkdtempSync(path.join(tmpdir(),'orivane-test-')),dbPath=path.join(dir,'test.sqlite');let app=createApp({dbPath,network:false});try{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;const state=await fetch(base+'/api/state').then(r=>r.json());assert.ok(state.radar.length>=4);assert.equal(state.account.equity,100000);assert.ok(state.radar.every(r=>!r.live));let r=await fetch(base+'/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(defaultProfile)});assert.equal(r.status,403);r=await fetch(base+'/api/profile',{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify({...defaultProfile,name:'Test confirmed',capital:2500,confirmed:true,allowedSymbols:['BTC/USD']})});assert.equal(r.status,200);const resized=await fetch(base+'/api/state').then(r=>r.json());assert.equal(resized.account.equity,2500);assert.equal(resized.account.dayLoss,0);r=await fetch(base+'/api/paper/open',{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':state.token},body:JSON.stringify({symbol:'BTC/USD',strategy:'breakout'})});assert.equal(r.status,422);assert.match((await r.json()).error,/actuel/);const denied=await new Promise(resolve=>{http.get(base+'/api/state',{headers:{Host:'evil.test'}},response=>{response.resume();resolve(response.statusCode);});});assert.equal(denied,403);assert.equal((await fetch(base+'/api/export').then(r=>r.json())).positions.length,0);await app.close();app=createApp({dbPath,network:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/state').then(r=>r.json())).profile.name,'Test confirmed');}finally{await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'orivane-test-'));rmSync(dir,{recursive:true,force:true});}});
