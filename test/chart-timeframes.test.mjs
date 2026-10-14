import test from 'node:test';import assert from 'node:assert/strict';import {aggregateChartBars} from '../src/chart-timeframes.mjs';
const start=Date.UTC(2026,9,13,8),bars=Array.from({length:16},(_,i)=>({time:new Date(start+i*900000).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i,volume:10+i,closed:true}));
test('higher-timeframe OHLC and volume equal independent group calculations',()=>{
 const hour=aggregateChartBars(bars,60,{now:start+14400000});assert.equal(hour.length,4);assert.deepEqual(hour[0],{time:new Date(start).toISOString(),open:100,high:105,low:99,close:104,volume:46,closed:true,sourceBars:4,timeframe:60});
 const four=aggregateChartBars(bars,240,{now:start+14400000});assert.equal(four.length,1);assert.equal(four[0].high,117);assert.equal(four[0].close,116);assert.equal(four[0].volume,280);
});
test('gaps, duplicates, invalid candles and incomplete past buckets are not filled',()=>{
 assert.equal(aggregateChartBars(bars.filter((_,i)=>i!==1),60,{now:start+14400000}).length,3);
 assert.equal(aggregateChartBars([bars[0],bars[0],...bars.slice(1)],60,{now:start+14400000}).length,3);
 assert.equal(aggregateChartBars(bars.slice(1),60,{now:start+14400000}).length,3);
 assert.equal(aggregateChartBars([{...bars[0],low:150},...bars.slice(1)],60,{now:start+14400000}).length,3);
 assert.deepEqual(aggregateChartBars(bars.slice(0,2),60,{now:start+7200000}),[]);
});
test('the real current partial bucket stays active; volume remains unavailable when absent',()=>{
 const input=bars.slice(0,2).map(b=>({...b,volume:null})),before=structuredClone(input),r=aggregateChartBars(input,60,{now:start+1800000});
 assert.equal(r.length,1);assert.equal(r[0].closed,false);assert.equal(r[0].sourceBars,2);assert.equal(r[0].volume,null);assert.deepEqual(input,before);
 assert.throws(()=>aggregateChartBars(input,1));
});
