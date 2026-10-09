import test from 'node:test';
import assert from 'node:assert/strict';
import {candleQuality} from '../src/candle-quality.mjs';
import {signal,strategies,backtest,setupTriggers} from '../src/engine.mjs';
import {routeStrategy} from '../src/decision.mjs';
const start=Date.UTC(2026,0,1),step=900000;
const bar=(i,o,c,h,l)=>({time:new Date(start+i*step).toISOString(),open:o,close:c,high:h,low:l,volume:0});
function fixture(){
  const b=Array.from({length:100},(_,i)=>bar(i,90+i*.05-.1,90+i*.05,90+i*.05+.5,90+i*.05-.5));
  b[77]=bar(77,94.5,94.1,94.8,92.5);
  b[78]=bar(78,94.2,93.9,94.4,93.3);
  b[79]=bar(79,94,95.3,95.5,93.8);
  return b;
}
const reflect=b=>b.map(x=>({...x,open:200-x.open,close:200-x.close,high:200-x.low,low:200-x.high}));
test('two-bar recovery confirms both directions and invalidates beyond the entire three-candle structure',()=>{
  for(const [b,side] of [[fixture().slice(0,80),'BUY'],[reflect(fixture().slice(0,80)),'SELL']]){
    const s=signal(b,'two-bar-pullback');assert.equal(s.side,side);
    assert.equal(routeStrategy(b).strategy,'two-bar-pullback');assert.match(routeStrategy(b).why,/Deux bougies/);
    assert.ok(side==='BUY'?s.stop<Math.min(...b.slice(-3).map(x=>x.low)):s.stop>Math.max(...b.slice(-3).map(x=>x.high)));
    assert.ok(side==='BUY'?s.stop<s.entry&&s.target>s.entry:s.stop>s.entry&&s.target<s.entry);
  }
});
test('two-bar recovery rejects gaps, wrong pullback direction and an unconfirmed close',()=>{
  for(const mutate of [b=>b[77].time=new Date(start+76.5*step).toISOString(),b=>b[77].open=94,b=>b[79].close=94.7]){
    const b=fixture().slice(0,80);mutate(b);assert.equal(signal(b,'two-bar-pullback').side,'HOLD');
  }
  const b=fixture().slice(0,80);b[79].closed=false;assert.equal(signal(b,'two-bar-pullback').side,'HOLD');
});
test('conditional recovery ideas expose observed extremes without anticipating the next candle',()=>{
  const b=fixture().slice(0,79),before=structuredClone(b),idea=setupTriggers(b,'two-bar-pullback');
  assert.equal(idea.BUY.price,94.8);assert.equal(idea.SELL.price,92.5);assert.deepEqual(b,before);
});
test('recent-window quality accepts valid closed bars and excludes forming data without mutation',()=>{
  const b=fixture().slice(0,80);b.push({...bar(80,95,95,96,94),closed:false});
  const before=structuredClone(b),q=candleQuality(b,{now:start+80*step});
  assert.equal(q.status,'complete');assert.equal(q.scanned,80);assert.equal(q.formingExcluded,1);assert.deepEqual(b,before);
});
test('quality identifies missing intervals without manufacturing candles',()=>{
  const b=fixture().slice(0,80);b.splice(76,2);const q=candleQuality(b,{now:start+80*step});
  assert.equal(q.status,'gaps');assert.equal(q.gaps,1);assert.equal(q.missingIntervals,2);assert.equal(q.scanned,78);
});
test('quality detects duplicate, reversed and unfinished bars independently',()=>{
  const b=fixture().slice(0,80);b[77].time=b[76].time;b[78].time=b[75].time;
  const q=candleQuality(b,{now:start+79*step});assert.equal(q.status,'invalid');assert.ok(q.duplicates>0);assert.ok(q.outOfOrder>0);assert.equal(q.unfinished,1);
});
test('quality handles malformed rows, OHLC and clocks as invalid or unavailable',()=>{
  for(const row of [null,{}, {...bar(0,100,100,101,99),low:102},{...bar(0,100,100,101,99),volume:-1}])assert.equal(candleQuality([row],{now:start+step}).status,'invalid');
  for(const options of [{now:NaN},{timeframe:0},{timeframe:Infinity},{timeframe:Number.MAX_VALUE}])assert.equal(candleQuality([],options).status,'unavailable');
  assert.equal(candleQuality([]).status,'unavailable');
});
for(const strategy of strategies)test(strategy.id+' historical outcomes do not read candles after the requested end',()=>{
  const b=fixture(),end=84,reference=backtest(b,strategy.id,{end,feeBps:0,slippageBps:0});
  const changed=b.map((x,i)=>i<end?x:{...x,open:200,close:20,high:400,low:1});
  assert.deepEqual(backtest(changed,strategy.id,{end,feeBps:0,slippageBps:0}),reference);
  assert.deepEqual(backtest(b.slice(0,end),strategy.id,{feeBps:0,slippageBps:0}),reference);
});
