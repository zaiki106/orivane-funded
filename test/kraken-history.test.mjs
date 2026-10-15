import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKrakenHistory} from '../src/kraken-history.mjs';
const start=Date.UTC(2026,0,1),row=i=>[(start+i*900000)/1000,'100','102','99','101','100','20',8];
const payload=(count,receivedAt)=>({receivedAt,ohlc:{error:[],result:{XXBTZUSD:Array.from({length:count},(_,i)=>row(i)),last:0}},ticker:{error:[],result:{XXBTZUSD:{c:['101'],b:['100.9'],a:['101.1']}}}});
test('ahead-of-device server clock retains only true past source timestamps without moving time',()=>{
 const now=start+3*900000+30000,result=normalizeKrakenHistory(payload(10,new Date(now+7200000).toISOString()),{now});
 assert.equal(result.bars.length,3);assert.equal(result.bars.at(-1).time,new Date(start+2*900000).toISOString());assert.equal(result.currentBar,null);
 assert.equal(result.provenance.clockSkewDetected,true);assert.equal(result.provenance.clockOffsetMs,7200000);assert.equal(result.provenance.futureBarsRejected,7);
 assert.equal(result.quote.receivedAt,new Date(now).toISOString());assert.equal(result.quote.serverReceivedAt,new Date(now+7200000).toISOString());
});
test('normal source retains current partial separately and never labels the last provider entry closed',()=>{
 const now=start+3*900000+10000,result=normalizeKrakenHistory(payload(4,new Date(now).toISOString()),{now});assert.equal(result.bars.length,3);assert.equal(result.currentBar.closed,false);assert.equal(result.provenance.clockSkewDetected,false);
});
test('malformed prices, time order, provider error and crossed book are rejected',()=>{
 const now=start+4*900000;for(const change of [p=>p.ohlc.error.push('error'),p=>p.ohlc.result.XXBTZUSD[1][0]=p.ohlc.result.XXBTZUSD[0][0],p=>p.ohlc.result.XXBTZUSD[0][2]='1',p=>p.ticker.result.XXBTZUSD.b=['102']]){const p=payload(4,new Date(now).toISOString());change(p);assert.throws(()=>normalizeKrakenHistory(p,{now}));}
});
