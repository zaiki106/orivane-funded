import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDecisions} from '../src/decision-replay.mjs';
import {decide,decisionVersion,classes,featureNames,featureWindow} from '../src/decision.mjs';
import {backtest,signal} from '../src/engine.mjs';

function fixture(side='BUY'){
  const bars=Array.from({length:100},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:100,high:i===99?105:101,low:99,close:i===99?104:100,volume:i===99?200:100}));
  const input=side==='BUY'?bars:bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  const d={symbol:'EUR/USD',source:'Replay unit fixture',timeframe:15,bars:input};
  const model={symbol:d.symbol,source:d.source,version:decisionVersion,classes:[...classes],featureWindow,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,
    weights:(side==='BUY'?[.8,.1,.1]:[.1,.8,.1]).map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)},event:{horizonBars:4},split:{test:{start:60}}};
  return {d,model};
}
function nextBar(bars,values){return {time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString(),volume:100,...values};}

test('strategy backtest preserves the original stop and target instead of moving them at next-bar execution',()=>{
  const {d}=fixture(),raw=signal(d.bars,'breakout'),entry=raw.entry+.2;
  d.bars.push(nextBar(d.bars,{open:entry,high:entry+.1,low:entry-.1,close:entry}));
  d.bars.push(nextBar(d.bars,{open:entry,high:entry+.1,low:entry-.1,close:entry}));
  const report=backtest(d.bars,'breakout',{start:100,feeBps:0,slippageBps:0});
  assert.equal(report.trades.length,1);assert.equal(report.trades[0].entry,entry);
  assert.equal(report.trades[0].stop,raw.stop);assert.equal(report.trades[0].target,raw.target);
});

test('frozen-model replay uses the selected rule, immutable levels, costs and conservative barrier order for both directions',()=>{
  for(const side of ['BUY','SELL']){
    const {d,model}=fixture(side),raw=decide(d.bars,model);assert.equal(raw.side,side);
    d.bars.push(nextBar(d.bars,{open:raw.entry,high:Math.max(raw.stop,raw.target)+.1,low:Math.min(raw.stop,raw.target)-.1,close:raw.entry}));
    const replay=replayDecisions(d,model);assert.equal(replay.trades.length,1);const trade=replay.trades[0];
    assert.equal(trade.side,side);assert.equal(trade.strategy,raw.strategy);assert.equal(trade.stop,raw.stop);assert.equal(trade.target,raw.target);assert.equal(trade.reason,'Stop');
    const direction=side==='BUY'?1:-1,entry=raw.entry*(1+direction*.0002),exit=raw.stop*(1-direction*.0002);
    assert.equal(trade.entry,entry);assert.equal(trade.exit,exit);
    assert.ok(Math.abs(trade.r-(direction*(exit-entry)-(exit+entry)*.0002)/(direction*(entry-exit)+(entry+exit)*.0002))<1e-10);
    assert.equal(replay.metrics.winRate,0);assert.equal(replay.publicationGateApplied,false);
    assert.equal(replay.status,'insufficient');assert.equal(replay.metrics.n,1);
  }
});

test('censored positions and missing bars never become invented wins',()=>{
  const {d,model}=fixture(),raw=decide(d.bars,model);
  d.bars.push(nextBar(d.bars,{open:raw.entry,high:raw.entry+.1,low:raw.entry-.1,close:raw.entry}));
  const unfinished=replayDecisions(d,model);assert.equal(unfinished.metrics.n,0);assert.equal(unfinished.counts.censored,1);assert.ok(unfinished.openPlan);
  d.bars.push({...nextBar(d.bars,{open:raw.target+1,high:raw.target+2,low:raw.target,close:raw.target+1}),time:new Date(Date.parse(d.bars.at(-1).time)+1800000).toISOString()});
  const gap=replayDecisions(d,model);assert.equal(gap.metrics.n,0);assert.equal(gap.counts.gaps,1);assert.equal(gap.counts.censored,1);
});

test('replay closes at the declared one-hour horizon and exposes cost sensitivity without overlapping positions',()=>{
  const {d,model}=fixture(),raw=decide(d.bars,model);
  for(let i=0;i<5;i++)d.bars.push(nextBar(d.bars,{open:raw.entry,high:raw.entry+.1,low:raw.entry-.1,close:raw.entry}));
  const r=replayDecisions(d,model),stress=replayDecisions(d,model,{costMultiplier:2});
  assert.equal(r.metrics.n,1);assert.equal(r.trades[0].reason,'Expiration à 60 min');
  assert.equal(Date.parse(r.trades[0].exitTime)-Date.parse(r.trades[0].time),3600000);
  assert.equal(r.counts.accepted,1);assert.ok(stress.metrics.totalR<r.metrics.totalR);
  assert.throws(()=>replayDecisions(d,model,{costMultiplier:NaN}));
});

test('replay refuses incompatible or future models, ignores forming bars and never applies final-test evidence retrospectively',()=>{
  const {d,model}=fixture();const baseline=replayDecisions(d,model);
  assert.equal(replayDecisions(d,{...model,source:'Wrong'}).status,'unavailable');
  assert.equal(replayDecisions(d,{...model,calibratedThrough:'2099-01-01T00:00:00Z'}).status,'unavailable');
  assert.deepEqual(replayDecisions({...d,bars:[...d.bars,{...d.bars.at(-1),closed:false,close:999}]},model),baseline);
  assert.deepEqual(replayDecisions(d,{...model,test:{brier:1,baselineBrier:0},audited:false}),baseline);
});
