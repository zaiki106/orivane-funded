import test from 'node:test';
import assert from 'node:assert/strict';
import {strategies,indicators,signal,setupTriggers,backtest} from '../src/engine.mjs';
import {strategyFixtures,routeFixtures,reflected} from './helpers/strategy-v7-fixtures.mjs';

const ids=['parabolic-sar','williams-recovery','fisher-recovery','trix','tsi','dema-reclaim','chandelier','vortex'];
const candles=values=>values.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(close,values[i-1]??close)+.1,low:Math.min(close,values[i-1]??close)-.1,close,volume:0}));
const flat=()=>candles(Array(80).fill(100));
test('the eight additional rules are real catalogue entries',()=>{
  for(const id of ids)assert.ok(strategies.some(s=>s.id===id),id);
  assert.equal(strategies.length,41);
});
test('the eight additional indicators are finite and flat prices create no signal',()=>{
  const q=indicators(flat());
  for(const field of ['sar','previousSar','sarDirection','previousSarDirection','sarAcceleration','sarExtreme','williamsR','previousWilliamsR','fisher','previousFisher','fisherTrigger','previousFisherTrigger','trix','previousTrix','trixSignal','previousTrixSignal','tsi','previousTsi','tsiSignal','previousTsiSignal','dema','previousDema','chandelierLong','previousChandelierLong','chandelierShort','previousChandelierShort','chandelierAtr','vortexPlus','previousVortexPlus','vortexMinus','previousVortexMinus'])assert.ok(Number.isFinite(q[field]),field);
  assert.equal(q.williamsR,-50);assert.equal(q.fisher,0);assert.equal(q.trix,0);assert.equal(q.tsi,0);assert.equal(q.dema,100);
  for(const id of ids){assert.equal(signal(flat(),id).side,'HOLD',id);assert.equal(signal(flat().slice(0,59),id).side,'HOLD',id);}
});

const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from independently derived ${expected}`);
test('indicator arithmetic matches a constant history followed by a known price impulse',()=>{
  const q=indicators(candles([...Array(80).fill(100),102]));
  near(q.sar,99.9);assert.equal(q.sarDirection,1);assert.equal(q.previousSarDirection,-1);near(q.sarAcceleration,.02);near(q.sarExtreme,102.1);
  near(q.williamsR,-100*.1/2.2);near(q.previousWilliamsR,-50);
  near(q.fisher,.5*Math.log(1.33/.67));near(q.fisherTrigger,0);near(q.previousFisherTrigger,0);
  // With alpha=1/8, a two-unit impulse reaches the third EMA as 2/8³.
  near(q.trix,2/512);near(q.trixSignal,(2/512)/5);
  near(q.tsi,100);near(q.tsiSignal,25);
  // DEMA21 impulse response: 2·(2/11) - 2/11².
  near(q.dema,100+42/121);near(q.previousDema,100);
  near(q.chandelierAtr,6.4/22);near(q.chandelierLong,102.1-3*6.4/22);near(q.chandelierShort,99.9+3*6.4/22);
  near(q.previousChandelierLong,99.5);near(q.previousChandelierShort,100.5);
  near(q.vortexPlus,1);near(q.vortexMinus,7/12);near(q.previousVortexPlus,1);near(q.previousVortexMinus,1);
});
test('recursive momentum and SAR retain their prior observation instead of resetting each candle',()=>{
  const q=indicators(candles([...Array(80).fill(100),102,104]));
  const expectedTrix=100*(100.01806640625/100.00390625-1);
  near(q.trix,expectedTrix);near(q.previousTrix,2/512);near(q.trixSignal,.2*expectedTrix+.8*(2/512)/5);
  near(q.tsi,100);near(q.previousTsiSignal,25);near(q.tsiSignal,43.75);
  near(q.sar,99.9);near(q.sarAcceleration,.04);near(q.sarExtreme,104.1);
});
test('oscillator singularities stay finite on zero range and Fisher saturation',()=>{
  const zero=flat().map(b=>({...b,open:100,high:100,low:100,close:100}));
  const q=indicators(zero);assert.equal(q.williamsR,-50);assert.equal(q.fisher,0);assert.equal(q.tsi,0);assert.equal(q.vortexPlus,0);assert.equal(q.vortexMinus,0);
  for(const id of ids)assert.equal(signal(zero,id).side,'HOLD');
  for(const input of [candles(Array.from({length:160},(_,i)=>100+i*.2)),candles(Array.from({length:160},(_,i)=>100-i*.2))]){
    const output=indicators(input);assert.ok(Number.isFinite(output.fisher));assert.ok(Math.abs(output.fisher)<8);assert.ok(output.sarAcceleration<=.2);assert.ok(output.tsi>=-100&&output.tsi<=100);
  }
});

for(const [id,bars] of Object.entries(strategyFixtures))test(id+' confirms both directions from raw candles and keeps fixed valid execution levels',()=>{
  for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    const result=signal(input,id),dir=side==='BUY'?1:-1;
    assert.equal(result.side,side);assert.equal(result.score,100);assert.ok(result.checks.every(c=>c.passed));
    assert.ok([result.entry,result.stop,result.target,result.riskDistance].every(v=>Number.isFinite(v)&&v>0));
    assert.ok(dir*(result.entry-result.stop)>0);assert.ok(dir*(result.target-result.entry)>0);
    near(Math.abs(result.target-result.entry)/result.riskDistance,result.rr);
    assert.equal(result.invalidation.price,result.stop);assert.equal(result.setup.stop,result.stop);assert.equal(result.setup.target,result.target);
    assert.equal(signal(input.slice(0,-1),id).side,'HOLD','A candle before the event is not a confirmed setup');
    assert.deepEqual(signal(input,id),result,'No random strategy output');
    const noBody=structuredClone(input);noBody.at(-1).open=noBody.at(-1).close;
    if(!['williams-recovery'].includes(id))assert.equal(signal(noBody,id).side,'HOLD','Missing directional candle blocks the event');
  }
});

test('forming candles cannot change indicators, new raw signals or next-candle ideas',()=>{
  for(const [id,bars] of Object.entries(strategyFixtures)){
    const next={...bars.at(-1),time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString(),closed:false,open:100,high:500,low:1,close:400};
    assert.deepEqual(indicators([...bars,next]),indicators(bars),id);
    assert.deepEqual(signal([...bars,next],id),signal(bars,id),id);
    assert.deepEqual(setupTriggers([...bars,next],id),setupTriggers(bars,id),id);
  }
});
test('next-candle ideas expose honest unknown price levels and actual current prerequisites',()=>{
  for(const id of ids){
    const input=strategyFixtures[id].slice(0,-1),triggers=setupTriggers(input,id);
    for(const side of ['BUY','SELL']){const t=triggers[side];assert.equal(t.price,null,id);assert.equal(t.mode,'indicator',id);assert.equal(t.conditional,true);assert.equal(t.referenceTime,input.at(-1).time);assert.ok(t.prerequisites.length>0);assert.ok(t.prerequisites.every(p=>typeof p.met==='boolean'));}
    assert.ok(triggers.BUY.prerequisites.every(p=>p.met),id+' must describe prerequisites already present before the event');
    assert.ok(triggers.SELL.prerequisites.some(p=>!p.met)||['trix','tsi','dema-reclaim','vortex','chandelier'].includes(id),id);
    if(id==='fisher-recovery')for(const side of ['BUY','SELL'])assert.equal(triggers[side].referencePrice,input.at(-1).close,'An oscillator cannot be published as a market price');
  }
});
test('the eight new backtests do not read future data or exit before entry',()=>{
  const bars=candles(Array.from({length:240},(_,i)=>100+Math.sin(i*.31)*4+Math.sin(i*.07)*2)),changed=structuredClone(bars);
  for(let i=180;i<changed.length;i++)for(const field of ['open','high','low','close'])changed[i][field]*=2;
  for(const id of ids){const original=backtest(bars,id,{end:180});assert.deepEqual(backtest(changed,id,{end:180}),original,id);for(const trade of original.trades)assert.ok(Date.parse(trade.exitTime)>=Date.parse(trade.time));}
});

test('eight distinct route-ready histories each confirm their event in both directions',()=>{
  for(const [id,bars] of Object.entries(routeFixtures))for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    assert.equal(signal(input,id).side,side,id);assert.equal(signal(input.slice(0,-1),id).side,'HOLD',id);
  }
});
