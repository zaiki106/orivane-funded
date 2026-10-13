import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linearRegression,efficiencyRatio,choppiness,weightedMean,advancedStrategies,advancedContext} from '../src/advanced-strategies.mjs';
import {signal,indicators,backtest,laboratory} from '../src/engine.mjs';
const bars=Array.from({length:300},(_,i)=>{const close=100+i*.025+Math.sin(i*.3)*2,open=close-Math.cos(i*.3)*.25;return {time:new Date(Date.UTC(2025,0,1)+i*900000).toISOString(),open,high:Math.max(open,close)+.2,low:Math.min(open,close)-.2,close,volume:100+i%17};});
const fixtures=JSON.parse(readFileSync(new URL('./helpers/advanced-signal-fixtures.json',import.meta.url)));
for(const rule of advancedStrategies)test(rule.id+' produces both raw directions with correctly ordered fixed levels',()=>{
 const buy=fixtures[rule.id],sell=buy.map(b=>({...b,open:300-b.open,high:300-b.low,low:300-b.high,close:300-b.close}));
 for(const [b,side] of [[buy,'BUY'],[sell,'SELL']]){const s=signal(b,rule.id),dir=side==='BUY'?1:-1;assert.equal(s.side,side);assert.ok(dir*(s.entry-s.stop)>0);assert.ok(dir*(s.target-s.entry)>0);assert.ok(s.checks.every(c=>c.passed));}
});
test('regression has independently known slope, endpoint and perfect fit',()=>{const r=linearRegression([3,5,7,9,11]);assert.equal(r.slope,2);assert.equal(r.endpoint,11);assert.equal(r.r2,1);assert.equal(r.sd,0);});
test('efficiency and weighted mean use direction-independent path and recent weights',()=>{assert.equal(efficiencyRatio([1,2,3,4],3),1);assert.equal(efficiencyRatio([4,3,2,1],3),1);assert.equal(efficiencyRatio([1,2,1],2),0);assert.equal(weightedMean([1,2,3]),14/6);});
test('choppiness matches a known true-range / channel calculation',()=>{const b=Array.from({length:15},(_,i)=>({high:11,low:9,close:10,time:new Date(i*900000).toISOString()}));assert.equal(choppiness(b),100);});
test('ALMA recent-price orientation and Coppock/KST/CMO match a single known impulse',()=>{
 const b=bars.slice(0,80).map(x=>({...x,open:100,high:101,low:99,close:100,volume:100}));b.at(-1).close=120;b.at(-1).high=120;
 const a=advancedContext(b),weights=Array.from({length:21},(_,i)=>Math.exp(-((i-17)**2)/(2*3.5**2))),total=weights.reduce((s,x)=>s+x,0);
 assert.ok(Math.abs(a.alma-(100+20*weights[20]/total))<1e-10);
 assert.ok(Math.abs(a.coppock-400/55)<1e-10);assert.equal(a.cmo,100);
 assert.ok(Math.abs(a.kst-(12+80/15))<1e-9);assert.ok(Math.abs(a.kstSignal-(12+80/15)/9)<1e-9);
 assert.ok(Math.abs(a.cmf-.05)<1e-12);
});
test('Hull 21 gives the analytically known endpoint on a linear series',()=>{
 const b=bars.slice(0,80).map((x,i)=>({...x,open:100+i,high:101+i,low:99+i,close:100+i}));
 assert.ok(Math.abs(advancedContext(b).hma-(179-1/3))<1e-10);
});
for(const rule of advancedStrategies)test(rule.id+' excludes forming candles, respects scale and detects gaps',()=>{
 const base=bars.slice(0,160),q=indicators(base),s=signal(base,rule.id,q);
 const forming={...bars[160],closed:false,close:100000,high:100001};assert.deepEqual(signal([...base,forming],rule.id),s);
 const scaled=base.map(b=>({...b,open:b.open*10,high:b.high*10,low:b.low*10,close:b.close*10})),r=signal(scaled,rule.id);
 assert.equal(r.side,s.side);assert.ok(Math.abs(r.stop/s.stop-10)<1e-7);assert.ok(Math.abs(r.target/s.target-10)<1e-7);
 const gapped=base.slice();gapped.splice(-10,1);assert.equal(signal(gapped,rule.id).side,'HOLD');
 assert.ok(s.directionalChecks.BUY.length>=4);assert.ok(s.directionalChecks.SELL.length>=4);
});
test('missing volume disables Chaikin rather than fabricating it',()=>{const no=bars.slice(-100).map(b=>({...b,volume:0}));assert.equal(advancedContext(no).cmf,null);assert.equal(signal(no,'cmf-breakout').side,'HOLD');});
test('incomplete previous UTC day is unavailable',()=>{const a=advancedContext(bars.slice(-70));assert.equal(a.dayHigh,null);assert.equal(a.dayLow,null);});
test('shared causal contexts preserve all strategy backtests exactly',()=>{
 const data={symbol:'TEST',source:'test-fixture',bars:bars.slice(0,180)},lab=laboratory(data),cache={bars:data.bars,values:new Map()};
 for(const rule of advancedStrategies){const plain=backtest(data.bars,rule.id),cached=backtest(data.bars,rule.id,{contextCache:cache});assert.deepEqual(cached,plain);assert.ok(lab.results.some(r=>r.id===rule.id));}
});
