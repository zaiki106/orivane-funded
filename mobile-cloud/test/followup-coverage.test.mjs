import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {makeTradePlan} from '../public/core/trade-outcome.mjs';

const root=new URL('../public/',import.meta.url),cost={feeBps:0,slippageBps:0};
async function worker({age=1000,legacyExpiry=null}={}){
 const at=Date.now()-age,boundary=Math.floor(at/900000)*900000;
 let source=await readFile(new URL('mobile-engine.mjs',root),'utf8'),now=at,imports={};
 for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g)){
  const module=await import(new URL(match[2],root));
  for(const name of match[1].split(',').map(x=>x.trim())){const [original,local]=name.split(/\s+as\s+/);imports[local??original]=module[original];}
 }
 class Socket{readyState=0;addEventListener(){}removeEventListener(){}close(){this.readyState=3;}send(){}}
 for(const key of ['KrakenLiveFeed','DerivLiveFeed','KrakenBookFeed']){const Base=imports[key];imports[key]=class extends Base{constructor(options){super({...options,WebSocketImpl:Socket});}};}
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const messages=[],context=vm.createContext({...imports,Date:Clock,crypto:webcrypto,URL,Intl,Response,TextDecoder,
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},fetch:async()=>new Response('{}',{status:502}),postMessage:message=>messages.push(structuredClone(message))});
 context.self=context;vm.runInContext(source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,''),context);
 // Existing journals used a physical entry timestamp without a boundary policy.
 const plan={...makeTradePlan({side:'BUY',strategy:'breakout',entry:100,stop:90,target:120,atr:10},{price:100},cost,{entryTime:boundary}),entryTimeMs:at,entryTime:new Date(at).toISOString(),expiryTimeMs:at+16*900000,expiryTime:new Date(at+16*900000).toISOString()};
 for(const key of ['entryPolicy','maxEntryDelayMs','executionTime','executionTimeMs'])delete plan[key];
 const event={id:'fixture-followup',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'breakout',side:'BUY',entry:100,stop:90,target:120,confidencePercent:73,confidenceKind:'tp_before_sl_probability',status:'watching',observedAt:new Date(at).toISOString(),signalObservedAt:new Date(at).toISOString(),referenceTime:plan.entryTime,horizonEndAt:plan.expiryTime,plan};
 if(legacyExpiry!==null){delete event.plan;event.horizonEndAt=new Date(at+legacyExpiry).toISOString();}
 await context.onmessage({data:{type:'init',saved:{followups:[event]}}});
 const bars=Array.from({length:100},(_,i)=>({time:new Date(boundary-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:100,closed:true}));
 context.install({symbol:event.symbol,source:event.source,timeframe:15,bars,provenance:{syntheticTestOnly:true}});
 return {context,messages,send(price,elapsed){now=at+elapsed;context.update({symbol:event.symbol,quote:{price,bid:price,ask:price,transport:'websocket',eventTime:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()}});},async journal(){return (await context.api('/api/export')).followups[0];}};
}

test('mobile followup distinguishes a continuous TP from a first quote after lost coverage',async()=>{
 const continuous=await worker();continuous.send(100,100);continuous.send(120,200);assert.equal((await continuous.journal()).status,'target-observed');
 const missing=await worker({age:40000});missing.send(120,30001);const censored=await missing.journal();assert.equal(censored.status,'censored');assert.equal(censored.observedBarrier,'target');assert.equal(censored.observedPrice,120);assert.equal(censored.observationGap,true);
});

test('mobile followup records a short known reconnect without declaring first-TP success',async()=>{
 const e=await worker();e.send(100,100);vm.runInContext('kraken.generation++',e.context);e.send(120,200);
 const follow=await e.journal();assert.equal(follow.status,'censored');assert.equal(follow.observedBarrier,'target');assert.equal(follow.observationGap,true);assert.ok(follow.observationSession);assert.ok(follow.streamGeneration);
});

test('legacy followup expiry precedes a late target and keeps its real observed price',async()=>{
 const continuous=await worker({legacyExpiry:150});continuous.send(100,100);continuous.send(120,200);const expired=await continuous.journal();
 assert.equal(expired.status,'expired');assert.equal(expired.observedBarrier,'expired');assert.equal(expired.observedPrice,120);
 const interrupted=await worker({age:40000,legacyExpiry:150});interrupted.send(120,30001);const censored=await interrupted.journal();
 assert.equal(censored.status,'censored');assert.equal(censored.observedBarrier,'expired');assert.equal(censored.observedPrice,120);
});
