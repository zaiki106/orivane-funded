import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeKrakenHistory} from '../src/kraken-history.mjs';
import {validateBars} from '../src/engine.mjs';

test('clock-skewed source history keeps a causally valid closed prefix with unchanged prices',()=>{
 const now=Date.parse('2026-01-01T03:07:00Z'),start=Date.parse('2026-01-01T00:00:00Z');
 const rows=Array.from({length:20},(_,i)=>[(start+i*900000)/1000,'100','102','99','101','100','20',8]);
 const payload={receivedAt:new Date(now+7200000).toISOString(),ohlc:{error:[],result:{XXBTZUSD:rows,last:0}},ticker:{error:[],result:{XXBTZUSD:{c:['111'],b:['110.9'],a:['111.1']}}}};
 const r=normalizeKrakenHistory(payload,{now});
 assert.equal(r.bars.length,12);assert.equal(validateBars(r.bars,now).length,12);
 assert.ok(r.bars.every(b=>Date.parse(b.time)+900000<=now&&b.close===101));
 assert.equal(r.quote.price,111);assert.equal(r.quote.serverReceivedAt,payload.receivedAt);
 assert.equal(r.provenance.clockSkewDetected,true);assert.equal(r.currentBar,null);
});

test('startup resume should coalesce published-model and Nasdaq requests while cache restoration is pending',async()=>{
 const root=new URL('../mobile-cloud/public/',import.meta.url);
 let source=await readFile(new URL('mobile-engine.mjs',root),'utf8');const imports={};
 for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g)){
  const module=await import(new URL(match[2],root));for(const specifier of match[1].split(',').map(s=>s.trim())){const [original,alias]=specifier.split(/\s+as\s+/);imports[alias??original]=module[original];}
 }
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,'');
 class Socket{readyState=0;addEventListener(){}removeEventListener(){}close(){this.readyState=3;}send(){}}
 for(const name of ['KrakenLiveFeed','DerivLiveFeed','KrakenBookFeed']){const Base=imports[name];imports[name]=class extends Base{constructor(options){super({...options,WebSocketImpl:Socket});}};}
 let restoreCache,now=Date.now();const requests=[];
 class Clock extends Date{static now(){return now;}}
 const context=vm.createContext({...imports,Date:Clock,Map,Set,Math,JSON,Number,Array,Object,Promise,URL,Intl,crypto:webcrypto,
  readHistory:()=>new Promise(resolve=>{restoreCache=resolve;}),setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},postMessage(){},fetch:url=>{requests.push(String(url));return new Promise(()=>{});}});
 context.self=context;vm.runInContext(source,context);
 const initialization=context.onmessage({data:{type:'init'}});
 await context.onmessage({data:{type:'resume'}});restoreCache([]);await initialization;
 assert.deepEqual({kraken:requests.filter(url=>url==='/cloud/kraken').length,models:requests.filter(url=>url==='/models/index.json').length,nasdaq:requests.filter(url=>url==='/cloud/nasdaq').length},
  {kraken:1,models:1,nasdaq:1},'resume + init must coalesce each outstanding provider/model request');
 // A slow provider can outlast the five-second resume throttle. Another
 // lifecycle event should reuse requests still in flight, rather than fan out.
 now+=6000;await context.onmessage({data:{type:'resume'}});
 assert.deepEqual({kraken:requests.filter(url=>url==='/cloud/kraken').length,models:requests.filter(url=>url==='/models/index.json').length,nasdaq:requests.filter(url=>url==='/cloud/nasdaq').length},
  {kraken:1,models:1,nasdaq:1},'later resume must reuse still-pending provider/model requests');
});
