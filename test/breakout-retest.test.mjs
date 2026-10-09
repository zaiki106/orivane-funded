import test from 'node:test';
import assert from 'node:assert/strict';
import {signal,indicators,setupTriggers,backtest} from '../src/engine.mjs';
import {routeStrategy} from '../src/decision.mjs';
const start=Date.UTC(2026,0,1),bar=(i,o,c,h,l)=>({time:new Date(start+i*900000).toISOString(),open:o,close:c,high:h,low:l,volume:0});
function fixture(){const b=Array.from({length:80},(_,i)=>bar(i,90+i*.05-.1,90+i*.05,90+i*.05+.5,90+i*.05-.5));b[77]=bar(77,94.2,94.9,95,94.1);b[78]=bar(78,94.8,94.6,94.95,94.2);b[79]=bar(79,94.8,95.4,95.6,94.7);return b;}
const reflect=b=>b.map(x=>({...x,open:200-x.open,close:200-x.close,high:200-x.low,low:200-x.high}));
test('breakout retest uses the channel before the break, confirms both directions and covers all three candles',()=>{
  for(const [b,side] of [[fixture(),'BUY'],[reflect(fixture()),'SELL']]){
    const s=signal(b,'breakout-retest'),dir=side==='BUY'?1:-1;
    assert.equal(s.side,side);assert.equal(routeStrategy(b).strategy,'breakout-retest');assert.match(routeStrategy(b).why,/retest/);
    assert.ok(dir*(s.entry-s.stop)>0&&dir*(s.target-s.entry)>0);
    assert.ok(side==='BUY'?s.stop<Math.min(...b.slice(-3).map(x=>x.low)):s.stop>Math.max(...b.slice(-3).map(x=>x.high)));
    const before=structuredClone(b);b[79].high=150;assert.equal(indicators(b).retestHigh,indicators(before).retestHigh);
  }
});
test('breakout retest refuses wick-only breaks, lost levels, unconfirmed closes and channel gaps',()=>{
  for(const mutate of [b=>b[77].close=94.25,b=>b[78].close=94.25,b=>b[78].close=94.95,b=>b[79].close=94.95,b=>b[60].time=new Date(start+60.5*900000).toISOString()]){
    const b=fixture();mutate(b);assert.equal(signal(b,'breakout-retest').side,'HOLD');
  }
  const b=fixture();b.at(-1).closed=false;assert.equal(signal(b,'breakout-retest').side,'HOLD');
});
test('next-candle retest ideas require an already closed break and held retest, without proposed fills',()=>{
  const b=fixture().slice(0,79),p=setupTriggers(b,'breakout-retest');
  assert.equal(p.BUY.price,94.95);assert.equal(p.BUY.mode,'close_above');assert.ok(p.BUY.prerequisites.every(x=>x.met));
  assert.ok(p.SELL.prerequisites.some(x=>!x.met));assert.ok(!('stop'in p.BUY));
});
test('new retest backtest outcomes remain unchanged when future candles are added past the test boundary',()=>{
  const b=fixture();b.push(bar(80,95.4,96,96.2,95.3),bar(81,96,98,98.1,95.9));
  const a=backtest(b,'breakout-retest',{feeBps:0,slippageBps:0});assert.equal(a.n,1);
  const future=[...b,bar(82,98,10,150,1)];assert.deepEqual(backtest(future,'breakout-retest',{end:82,feeBps:0,slippageBps:0}),a);
});
