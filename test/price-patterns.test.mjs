import test from 'node:test';
import assert from 'node:assert/strict';
import {signal,setupTriggers,indicators,backtest} from '../src/engine.mjs';
import {routeStrategy,decide,decisionVersion,classes,featureNames,featureWindow} from '../src/decision.mjs';
const start=Date.UTC(2026,0,1);
function fixture(id){
  const bars=Array.from({length:80},(_,i)=>{const c=90+i*.05;return {time:new Date(start+i*900000).toISOString(),open:c-.1,close:c,high:c+.5,low:c-.5,volume:0};});
  if(id==='engulfing-reclaim'){
    Object.assign(bars.at(-2),{open:94,close:93,high:94.2,low:92.8});
    Object.assign(bars.at(-1),{open:93,close:95,high:95.2,low:92.9});
  }else{
    Object.assign(bars.at(-2),{open:94.5,close:94.55,high:94.6,low:94.4});
    Object.assign(bars.at(-1),{open:94.55,close:95.1,high:95.2,low:94.5});
  }
  return bars;
}
const reflect=bars=>bars.map(b=>({...b,open:200-b.open,close:200-b.close,high:200-b.low,low:200-b.high}));
const model=side=>({version:decisionVersion,classes:[...classes],featureWindow,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:(side==='BUY'?[.8,.1,.1]:[.1,.8,.1]).map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}});
for(const id of ['nr7-breakout','engulfing-reclaim'])test(id+' triggers both directions from closed OHLC and uses structural levels',()=>{
  for(const [bars,side] of [[fixture(id),'BUY'],[reflect(fixture(id)),'SELL']]){
    const s=signal(bars,id),dir=side==='BUY'?1:-1,q=indicators(bars);
    assert.equal(s.side,side);assert.equal(routeStrategy(bars).strategy,id);
    const expectedStop=(dir===1?Math.min(bars.at(-1).low,bars.at(-2).low):Math.max(bars.at(-1).high,bars.at(-2).high))-dir*.1*q.atr;
    assert.equal(s.stop,expectedStop);assert.equal(s.target,s.entry+dir*Math.abs(s.entry-expectedStop)*1.8);
    assert.equal(s.riskModel,'structure');assert.ok(dir*(s.entry-s.stop)>0&&dir*(s.target-s.entry)>0);
    assert.equal(decide(bars).side,'HOLD'); // A pattern alone cannot invent >60% confidence.
    assert.equal(decide(bars,model(side)).side,side);
    assert.equal(decide(bars,model(side)).confidence.percent,80);
    const forming={...bars.at(-1),time:new Date(start+80*900000).toISOString(),closed:false,high:199,low:1,close:198};
    assert.deepEqual(signal([...bars,forming],id),s);
    const gap=bars.map(b=>({...b}));gap.at(-1).time=new Date(start+81*900000).toISOString();
    assert.equal(signal(gap,id).side,'HOLD');
  }
});
test('NR7 excludes the breakout bar, requires a strictly smaller range and exposes only conditional next boundaries',()=>{
  const bars=fixture('nr7-breakout'),q=indicators(bars);
  assert.equal(q.previousNr7,true);
  const next=setupTriggers(bars.slice(0,-1),'nr7-breakout');
  assert.equal(next.BUY.price,94.6);assert.equal(next.SELL.price,94.4);assert.equal(next.BUY.prerequisites[0].met,true);
  const tied=bars.map(b=>({...b}));Object.assign(tied.at(-3),{high:94.6,low:94.4,open:94.5,close:94.5});
  assert.equal(signal(tied,'nr7-breakout').side,'HOLD');
});
test('engulfing rejects a doji and equal body endpoint, never invents a future exact entry',()=>{
  const bars=fixture('engulfing-reclaim'),triggers=setupTriggers(bars.slice(0,-1),'engulfing-reclaim');
  assert.equal(triggers.BUY.price,null);assert.equal(triggers.BUY.prerequisites[0].met,true);
  const equal=bars.map(b=>({...b}));equal.at(-1).close=94;assert.equal(signal(equal,'engulfing-reclaim').side,'HOLD');
  const doji=bars.map(b=>({...b}));doji.at(-2).close=94;assert.equal(signal(doji,'engulfing-reclaim').side,'HOLD');
});
test('new rules run in chronological costed backtests without inventing trades from the last bar',()=>{
  for(const id of ['nr7-breakout','engulfing-reclaim']){
    const bars=fixture(id);assert.equal(backtest(bars,id,{start:60}).n,0);
    const more=[...bars,...[80,81].map(i=>({...bars.at(-1),time:new Date(start+i*900000).toISOString(),open:bars.at(-1).close,high:100,low:94.9,close:99}))];
    const r=backtest(more,id,{start:60,feeBps:1,slippageBps:1});assert.ok(r.n>=1);assert.ok(r.trades.every(t=>Number.isFinite(t.r)));
  }
});
