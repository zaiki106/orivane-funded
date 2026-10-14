import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {expansionContext,expansionStrategies,emaSeries} from '../src/expansion-strategies.mjs';
import {signal,indicators,backtest} from '../src/engine.mjs';
const input=JSON.parse(readFileSync(new URL('./helpers/indicator-oracle-input.json',import.meta.url))),oracle=JSON.parse(readFileSync(new URL('./helpers/indicator-oracle-expected.json',import.meta.url)));
for(const row of oracle.rows)test(row.id+' matches the independently executed pinned Python implementations',()=>{
 const actual=expansionContext(input.find(x=>x.id===row.id).bars);
 for(const [key,value] of Object.entries(row.expected)){const values=typeof value==='object'?Object.entries(value):[['vhf',value]];
  for(const [part,expected] of values){const got=part==='vhf'?actual.vhf:actual[key][part];if(expected===null)assert.equal(got,null,key+' '+part);else assert.ok(Math.abs(got-expected)<=1e-9*Math.max(1,Math.abs(expected)),key+' '+part+': '+got+' vs '+expected);}
 }
});
test('all new rules exclude forming candles, gaps, unavailable volume and future input',()=>{
 const bars=input[0].bars.slice(-160),q=indicators(bars),forming={...bars.at(-1),time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString(),closed:false,high:1000,low:1,close:900};
 const gap=bars.map((b,i)=>i===bars.length-2?{...b,time:new Date(Date.parse(b.time)-900000).toISOString()}:b);
 for(const rule of expansionStrategies){
  assert.deepEqual(signal([...bars,forming],rule.id),signal(bars,rule.id));
  assert.equal(signal(gap,rule.id).side,'HOLD');
  assert.equal(signal(bars.slice(0,59),rule.id).side,'HOLD');
  if(['force-cross','eom-cross','nvi-reclaim','vpt-cross','adl-breakout','mfi-recovery'].includes(rule.id))assert.equal(signal(bars.map(b=>({...b,volume:0})),rule.id).side,'HOLD');
  assert.ok(signal([],rule.id,q).checks.length>=6);
  assert.deepEqual(backtest([...bars,forming],rule.id),backtest(bars,rule.id));
 }
});
test('EMA uses standard adjust-false missing-value weights without a made-up oscillator input',()=>{
 const got=emaSeries([10,20,null,30],2);assert.equal(got[0],null);
 for(const [i,value] of [[1,50/3],[2,50/3],[3,590/21]])assert.ok(Math.abs(got[i]-value)<1e-12);
});
