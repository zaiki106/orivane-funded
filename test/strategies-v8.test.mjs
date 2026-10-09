import test from 'node:test';
import assert from 'node:assert/strict';
import {strategies,indicators,signal,setupTriggers,analysisWindow,backtest} from '../src/engine.mjs';
import {strategyFixtures,routeFixtures,reflected} from './helpers/strategy-v8-fixtures.mjs';

const ids=['kama-reclaim','ppo','ultimate-recovery','smi','stoch-rsi','elder-ray','demarker','awesome'];
const candles=values=>values.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(close,values[i-1]??close)+.1,low:Math.min(close,values[i-1]??close)-.1,close,volume:0}));
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from independently derived ${expected}`);
test('v8 adds eight named causal rules without enlarging the analysis window',()=>{
  assert.equal(strategies.length,41);assert.equal(analysisWindow,160);
  for(const id of ids)assert.ok(strategies.some(rule=>rule.id===id),id);
});
test('v8 indicator arithmetic matches a constant history and a known impulse',()=>{
  const q=indicators(candles([...Array(80).fill(100),102]));
  near(q.kama,100+8/9);near(q.previousKama,100);near(q.kamaEfficiency,1);near(q.kamaSmoothing,4/9);
  const ppo=100*(4/13-4/27)/(100+4/27);near(q.ppo,ppo);near(q.previousPpo,0);near(q.ppoSignal,ppo/5);
  const pressure=n=>(n*.1+2)/(n*.2+2);near(q.ultimate,100*(4*pressure(7)+2*pressure(14)+pressure(28))/7);near(q.previousUltimate,50);
  near(q.smi,500/7);near(q.smiSignal,250/7);near(q.previousSmi,0);near(q.previousSmiSignal,0);
  near(q.stochRsiK,200/3);near(q.stochRsiD,500/9);near(q.previousStochRsiK,50);near(q.previousStochRsiD,50);
  near(q.elderEma,100+2/7);near(q.bullsPower,2.1-2/7);near(q.bearsPower,-.1-2/7);near(q.previousBullsPower,.1);near(q.previousBearsPower,-.1);
  near(q.demarker,1);near(q.previousDemarker,.5);near(q.awesome,1/5-1/34);near(q.previousAwesome,0);
});
test('v8 singularities are neutral and finite on truly flat zero-range candles',()=>{
  const bars=candles(Array(80).fill(100)).map(b=>({...b,open:100,high:100,low:100,close:100})),q=indicators(bars);
  for(const key of ['kama','previousKama','kamaEfficiency','kamaSmoothing','ppo','previousPpo','ppoSignal','previousPpoSignal','ultimate','previousUltimate','smi','previousSmi','smiSignal','previousSmiSignal','stochRsiK','previousStochRsiK','stochRsiD','previousStochRsiD','elderEma','previousElderEma','bullsPower','previousBullsPower','bearsPower','previousBearsPower','demarker','previousDemarker','awesome','previousAwesome'])assert.ok(Number.isFinite(q[key]),key);
  near(q.kama,100);near(q.kamaEfficiency,0);near(q.kamaSmoothing,(2/31)**2);near(q.ultimate,50);near(q.smi,0);near(q.stochRsiK,50);near(q.demarker,.5);near(q.awesome,0);
  for(const id of ids){assert.equal(signal(bars,id).side,'HOLD',id);assert.equal(signal(bars.slice(0,59),id).side,'HOLD',id);}
});
test('v8 next-candle ideas do not invent future indicator prices and expose current prerequisites',()=>{
  const bars=candles(Array(80).fill(100));
  for(const id of ids){const ideas=setupTriggers(bars,id);for(const side of ['BUY','SELL']){assert.equal(ideas[side].price,null,id);assert.equal(ideas[side].mode,'indicator',id);assert.ok(ideas[side].prerequisites.length>0,id);assert.ok(ideas[side].prerequisites.every(item=>typeof item.met==='boolean'),id);assert.equal(ideas[side].referenceTime,bars.at(-1).time,id);}}
});
test('v8 recursive smoothers retain their preceding observation on a second impulse',()=>{
  const q=indicators(candles([...Array(80).fill(100),102,104])),firstPpo=100*(4/13-4/27)/(100+4/27),secondPpo=100*((100+148/169)/(100+316/729)-1);
  near(q.kama,100+184/81);near(q.previousKama,100+8/9);
  near(q.ppo,secondPpo);near(q.previousPpo,firstPpo);near(q.ppoSignal,secondPpo/5+firstPpo*4/25);
  near(q.smi,1500/17);near(q.previousSmi,500/7);near(q.smiSignal,750/17+125/7);
  near(q.stochRsiK,250/3);near(q.stochRsiD,200/3);near(q.previousStochRsiK,200/3);
  near(q.elderEma,100+40/49);near(q.previousElderEma,100+2/7);
});
test('KAMA uses a real ten-change efficiency window and a ten-close SMA seed',()=>{
  const bars=candles(Array.from({length:80},(_,i)=>100+i)),q=indicators(bars);
  // A perfect linear trend has ER=1, SC=4/9 and a closed-form lag of 5/4.
  near(q.kama,179-5/4-13/4*(5/9)**70);near(q.previousKama,178-5/4-13/4*(5/9)**69);
  near(q.kamaEfficiency,1);near(q.kamaSmoothing,4/9);
});
test('Ultimate accounts for prior-close gaps and DeMarker uses high/low changes',()=>{
  const gap=candles(Array(80).fill(100));gap.push({time:new Date(Date.parse(gap.at(-1).time)+900000).toISOString(),open:120,high:121,low:119,close:120,volume:0});
  const q=indicators(gap),ratio=n=>(.1*(n-1)+20)/(.2*(n-1)+21);near(q.ultimate,100*(4*ratio(7)+2*ratio(14)+ratio(28))/7);
  const range=candles(Array(80).fill(100));range.push({...range.at(-1),time:new Date(Date.parse(range.at(-1).time)+900000).toISOString(),open:100,high:103,low:98,close:101});
  near(indicators(range).demarker,29/48);
  const median=candles(Array(80).fill(100));median.push({...median.at(-1),time:new Date(Date.parse(median.at(-1).time)+900000).toISOString(),open:100,high:102,low:98,close:101});
  const m=indicators(median);near(m.awesome,0);assert.ok(m.ppo>0,'AO uses HL2, not close');
});
for(const [id,bars] of Object.entries(strategyFixtures))test(id+' confirms distinct real candle events in both directions with valid fixed levels',()=>{
  for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    const result=signal(input,id),direction=side==='BUY'?1:-1;
    assert.equal(result.side,side);assert.equal(result.score,100);assert.ok(result.checks.every(check=>check.passed));
    assert.ok([result.entry,result.stop,result.target,result.riskDistance].every(value=>Number.isFinite(value)&&value>0));
    assert.ok(direction*(result.entry-result.stop)>0);assert.ok(direction*(result.target-result.entry)>0);near(Math.abs(result.target-result.entry)/result.riskDistance,result.rr);
    assert.equal(result.invalidation.price,result.stop);assert.equal(result.setup.stop,result.stop);assert.equal(result.setup.target,result.target);
    assert.deepEqual(signal(input,id),result,'Deterministic calculation');
    if(id!=='elder-ray')assert.equal(signal(input.slice(0,-1),id).side,'HOLD','Fresh crossing must not precede the event');
    const withoutBody=structuredClone(input);withoutBody.at(-1).open=withoutBody.at(-1).close;assert.equal(signal(withoutBody,id).side,'HOLD','A missing confirming body blocks the rule');
    assert.deepEqual(ids.filter(other=>signal(input,other).side!=='HOLD'),[id],'The fixture contains a distinct event among the eight additions');
  }
});
test('forming candles change only the explicitly provisional preview for all eight new indicators',()=>{
  for(const [id,bars] of Object.entries(routeFixtures)){
    const forming={...bars.at(-1),time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString(),closed:false,open:100,high:500,low:1,close:400};
    assert.deepEqual(indicators([...bars,forming]),indicators(bars),id);assert.deepEqual(signal([...bars,forming],id),signal(bars,id),id);assert.deepEqual(setupTriggers([...bars,forming],id),setupTriggers(bars,id),id);
    const preview=indicators([...bars,forming],{includeForming:true});assert.equal(preview.last.time,forming.time);assert.notEqual(preview.kama,indicators(bars).kama,id);
  }
});
test('v8 previous fields equal the prior causal prefix and ideas report actual prerequisite states',()=>{
  const fields=[['kama','previousKama'],['ppo','previousPpo'],['ppoSignal','previousPpoSignal'],['ultimate','previousUltimate'],['smi','previousSmi'],['smiSignal','previousSmiSignal'],['stochRsiK','previousStochRsiK'],['stochRsiD','previousStochRsiD'],['elderEma','previousElderEma'],['bullsPower','previousBullsPower'],['bearsPower','previousBearsPower'],['demarker','previousDemarker'],['awesome','previousAwesome']];
  for(const [id,bars] of Object.entries(strategyFixtures)){
    const q=indicators(bars),prefix=indicators(bars.slice(0,-1));for(const [current,previous] of fields)near(q[previous],prefix[current]);
    const before=setupTriggers(bars.slice(0,-1),id);assert.ok(before.BUY.prerequisites.every(item=>item.met),id+' pre-event prerequisites');
    const confirmed=signal(bars,id);const future=[...bars,...candles([20,400,1]).map((bar,i)=>({...bar,time:new Date(Date.parse(bars.at(-1).time)+(i+1)*900000).toISOString()}))];
    assert.deepEqual(signal(future.filter(bar=>Date.parse(bar.time)<=Date.parse(bars.at(-1).time)),id),confirmed,'Later data cannot alter the earlier prefix');
  }
});
test('v8 backtests run all eight real rules with finite completed-trade accounting',()=>{
  const bars=candles(Array.from({length:320},(_,i)=>100+.01*i+3*Math.sin(i*.18)));
  for(const id of ids){const result=backtest(bars,id);assert.ok(Number.isFinite(result.totalR),id);assert.ok(result.trades.every(trade=>Number.isFinite(trade.r)&&trade.distance>0),id);}
});
