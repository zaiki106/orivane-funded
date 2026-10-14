import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {bookChecksum} from '../public/core/kraken-book.mjs';
import {makeTradePlan} from '../public/core/trade-outcome.mjs';
const root=new URL('../public/',import.meta.url);
async function environment(file,extra={}){
 let source=await fs.readFile(new URL(file,root),'utf8');const imports={};
 for(const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g)){
  const module=await import(new URL(m[2],root));for(const name of m[1].split(',').map(s=>s.trim())){const [imported,local]=name.split(/\s+as\s+/);imports[local??imported]=module[imported];}
 }
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,'').replace(/export /g,'');
 class Socket{readyState=0;addEventListener(){}removeEventListener(){}close(){this.readyState=3;}send(){}}
 for(const name of ['KrakenLiveFeed','DerivLiveFeed','KrakenBookFeed'])if(imports[name]){const Base=imports[name];imports[name]=class extends Base{constructor(o){super({...o,WebSocketImpl:Socket});}};}
 const messages=[],timers=new Set(),context=vm.createContext({...imports,Date,Map,Set,Math,JSON,Number,Array,Object,Promise,URL,Intl,crypto:webcrypto,
  setTimeout:(fn,d)=>{const id=setTimeout(fn,d);timers.add(id);return id;},clearTimeout,
  setInterval:(fn,d)=>{const id=setInterval(fn,d);timers.add(id);return id;},clearInterval,
  fetch:async()=>new Response('{}',{status:502}),postMessage:m=>messages.push(structuredClone(m)),...extra});
 context.self=context;vm.runInContext(source,context);return {context,messages,close(){for(const id of timers){clearTimeout(id);clearInterval(id);}}};
}
import {fixture} from './helpers/worker-fixture.mjs';
test('BTC REST recovery replaces a stale streaming price and remains explicitly non-streaming',async()=>{
 const time=Math.floor(Date.now()/900000)*900000,bars=Array.from({length:101},(_,i)=>({time:new Date(time-(100-i)*900000).toISOString(),open:100,high:102,low:99,close:101,volume:100}));
 const rows=bars.map(b=>[Date.parse(b.time)/1000,String(b.open),String(b.high),String(b.low),String(b.close),'100','100',10]);
 const payload={receivedAt:new Date().toISOString(),ohlc:{error:[],result:{XXBTZUSD:rows,last:time/1000}},ticker:{error:[],result:{XXBTZUSD:{c:['101'],b:['100.9'],a:['101.1']}}}};
 const e=await environment('mobile-engine.mjs',{fetch:async url=>new Response(String(url).includes('/cloud/kraken')?JSON.stringify(payload):'{}',{status:String(url).includes('/cloud/kraken')?200:502})});
 try{await e.context.onmessage({data:{type:'init'}});e.context.install({symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,bars:bars.slice(0,-1),quote:{price:100,bid:99.9,ask:100.1,transport:'websocket',receivedAt:new Date(Date.now()-60000).toISOString()}});
  await e.context.btcHistory();const row=e.messages.filter(m=>m.type==='state').at(-1).state.radar.find(r=>r.symbol==='BTC/USD');
  assert.equal(row.quote.price,101);assert.equal(row.quote.transport,'rest');assert.equal(row.feed.status,'snapshot');assert.equal(row.live,false);assert.equal(row.decision.side,'HOLD');
 }finally{e.close();}
});

test('book arriving before history remains HOLD instead of crashing the mobile worker',async()=>{
 const e=await environment('mobile-engine.mjs');try{const now=new Date().toISOString(),asks=[{price:'101',qty:'1'}],bids=[{price:'99',qty:'1'}];
  e.context.bookMessage={channel:'book',type:'snapshot',data:[{symbol:'BTC/USD',timestamp:now,asks,bids,checksum:bookChecksum(asks,bids)}]};
  vm.runInContext('bookFeed.book.ingest(bookMessage)',e.context);
  const decision=e.context.current('BTC/USD');assert.equal(decision.side,'HOLD');assert.equal(decision.entry,null);
 }finally{e.close();}
});
test('corrupt stored journal is preserved and cannot emit an empty replacement save',async()=>{
 const e=await environment('mobile-engine.mjs');try{await e.context.onmessage({data:{type:'init',saved:{positions:[{quantity:-1}]}}});
  assert.equal(e.messages.filter(m=>m.type==='saved').length,0);assert.equal(e.messages.find(m=>m.type==='state').state.platform.privateRestore.status,'blocked');
  await assert.rejects(e.context.api('/api/export'),/non restauré/);
 }finally{e.close();}
});
test('worker settles the first received barrier without waiting for its one-second display timer',async()=>{
 const e=await environment('mobile-engine.mjs');try{const at=Date.now()-1000,boundary=Math.floor(at/900000)*900000,cost={feeBps:0,slippageBps:0},plan=makeTradePlan({side:'BUY',strategy:'breakout',entry:100,stop:90,target:120,atr:10},{price:100},cost,{entryTime:boundary});
  const p={id:'first-event',symbol:'BTC/USD',source:'Kraken public · spot',side:'BUY',strategy:'breakout',mode:'paper-device',status:'open',entry:100,stop:90,target:120,netRisk:10,quantity:1,cost,plan,openedAt:plan.executionTime,lastObservationTime:at-100};
  await e.context.onmessage({data:{type:'init',saved:{positions:[p]}}});
  e.context.install({symbol:p.symbol,source:p.source,timeframe:15,bars:fixture.bars});
  e.context.update({symbol:p.symbol,quote:{price:120,bid:120,ask:120,transport:'websocket',eventTime:new Date(at+100).toISOString(),receivedAt:new Date(at+100).toISOString()}});
  e.context.update({symbol:p.symbol,quote:{price:90,bid:90,ask:90,transport:'websocket',eventTime:new Date(at+200).toISOString(),receivedAt:new Date(at+200).toISOString()}});
  const exported=await e.context.api('/api/export');assert.equal(exported.positions[0].outcome,'target');assert.equal(exported.positions[0].pnl,20);
 }finally{e.close();}
});
test('failed model worker releases the job and subsequent jobs reach a fresh worker',async()=>{
 const workers=[];class Worker{constructor(url){this.url=url;this.sent=[];workers.push(this);}postMessage(m){this.sent.push(m);}terminate(){this.terminated=true;}}
 const e=await environment('mobile-bridge.mjs',{Worker,localStorage:{getItem:()=>null,setItem(){}}});try{
  const engine=workers.find(w=>new URL(w.url,'https://device.invalid').pathname==='/mobile-engine.mjs'),model=workers.find(w=>new URL(w.url,'https://device.invalid').pathname==='/mobile-model-worker.mjs');
  engine.onmessage({data:{type:'model-request',symbol:'EUR/USD',version:1}});model.onerror();
  assert.equal(model.terminated,true);assert.equal(engine.sent.at(-1).type,'model-error');
  engine.onmessage({data:{type:'model-request',symbol:'GBP/USD',version:1}});
  assert.equal(workers.at(-1).sent.at(-1).symbol,'GBP/USD');
 }finally{e.close();}
});
test('quotes and state continue updating while the model job is pending; revised candles reject old results',async()=>{
 const e=await environment('mobile-engine.mjs');try{
  await e.context.onmessage({data:{type:'init'}});e.context.install(fixture);
  await new Promise(resolve=>setTimeout(resolve,30));
  const first=e.messages.find(m=>m.type==='model-request');assert.ok(first,'calculation must leave the quote worker');
  const catalogue=e.messages.filter(m=>m.type==='state').at(-1).state.radar.find(r=>r.symbol===first.symbol).signals;
  assert.equal(catalogue.length,66);assert.ok(catalogue.every(r=>r.checks.length>0));assert.ok(catalogue.some(r=>r.strategy==='alma-reclaim'));
  const initial=e.messages.filter(m=>m.type==='state').length;
  const nextPrice=fixture.bars.at(-1).close*1.00001;
  e.context.update({symbol:first.symbol,quote:{price:nextPrice,receivedAt:new Date().toISOString()}});
  await new Promise(resolve=>setTimeout(resolve,1100));assert.ok(e.messages.filter(m=>m.type==='state').length>initial,'state timer remains responsive');
  assert.equal(e.messages.filter(m=>m.type==='state').at(-1).state.radar.find(r=>r.symbol===first.symbol).quote.price,nextPrice);
  const revised={...fixture,bars:fixture.bars.map((b,i)=>i===fixture.bars.length-1?{...b,volume:(b.volume??0)+1}:b)};
  e.context.install(revised);
  await e.context.onmessage({data:{type:'model-fit',symbol:first.symbol,version:first.version,model:{status:'estimate'}}});
  let state=e.messages.filter(m=>m.type==='state').at(-1).state;
  assert.equal(state.radar.find(r=>r.symbol===first.symbol).model.status,'pending');
  await e.context.onmessage({data:{type:'model-complete',symbol:first.symbol,version:first.version}});
  const next=e.messages.filter(m=>m.type==='model-request').at(-1);assert.equal(next.version,first.version+1);
  await e.context.onmessage({data:{type:'model-error',symbol:next.symbol,version:next.version}});
  state=e.messages.filter(m=>m.type==='state').at(-1).state;
  assert.equal(state.radar.find(r=>r.symbol===next.symbol).model.status,'error');
  assert.equal(state.radar.find(r=>r.symbol===next.symbol).decision.side,'HOLD');
 }finally{e.close();}
});
test('separate model worker runs the real model and replay with the requested version',async()=>{
 const e=await environment('mobile-model-worker.mjs');try{
  await e.context.onmessage({data:{type:'model-request',symbol:fixture.symbol,version:4,dataset:fixture}});
  assert.deepEqual(e.messages.map(m=>m.type),['model-fit','model-complete']);
  assert.equal(e.messages[0].version,4);assert.equal(e.messages[0].model.version,'regime-classifier-v8');
  assert.ok(e.messages[1].lab.results.length===66);assert.ok(e.messages[1].replay.metrics);
 }finally{e.close();}
});

test('mobile paper stops use the liquidation book side rather than last trade',async()=>{
 for(const side of ['BUY','SELL']){
  const position={mode:'paper-device',strategy:'breakout',id:'exit-book-test',symbol:fixture.symbol,source:fixture.source,side,entry:100,stop:side==='BUY'?99.8:100.2,target:side==='BUY'?101:99,quantity:1,cost:{feeBps:0,slippageBps:0},status:'open',openedAt:new Date(Date.now()-100).toISOString(),netRisk:.2};
  const e=await environment('mobile-engine.mjs');try{
   await e.context.onmessage({data:{type:'init',saved:{positions:[position]}}});
   // Freshness is an independent, already tested boundary; isolate price-side semantics.
   e.context.recent=d=>Boolean(d?.quote);
   const quote={transport:'websocket',price:100,bid:side==='BUY'?99.7:99.9,ask:side==='SELL'?100.3:100.1,receivedAt:new Date().toISOString()};
   e.context.install({...fixture,quote});
   const state=e.messages.filter(m=>m.type==='state').at(-1).state;
   assert.equal(state.positions[0].status,'closed');assert.equal(state.positions[0].reason,'Stop observé');
   assert.equal(state.positions[0].exit,side==='BUY'?quote.bid:quote.ask);
   assert.ok(Math.abs(state.positions[0].pnl+.3)<1e-10);
  }finally{e.close();}
 }
});


