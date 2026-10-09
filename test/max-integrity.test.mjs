import test from 'node:test';
import assert from 'node:assert/strict';
import {signal,indicators,backtest} from '../src/engine.mjs';
import {routeStrategy} from '../src/decision.mjs';
import {decisionDiagnostics} from '../src/decision-diagnostics.mjs';
import {executionPlan} from '../src/execution-plan.mjs';
const start=Date.UTC(2026,0,1),bar=(i,o,c,h,l)=>({time:new Date(start+i*900000).toISOString(),open:o,close:c,high:h,low:l,volume:0});
function fixture(id){
  const b=Array.from({length:80},(_,i)=>bar(i,90+i*.05-.1,90+i*.05,90+i*.05+.5,90+i*.05-.5));
  if(id==='fractal-breakout'){
    b[76]=bar(76,93.8,94,95,93.5);b[77]=bar(77,93.9,94.1,94.7,93.7);b[78]=bar(78,94.1,94.2,94.8,93.6);b[79]=bar(79,94.9,95.5,95.7,94.7);
  }else if(id==='failed-breakout'){
    for(let i=0;i<78;i++)b[i]=bar(i,100,100,101,99);
    b[78]=bar(78,100.9,101.3,101.5,100.8);b[79]=bar(79,101.1,100,101.2,99.8);
  }else{
    b[78]=bar(78,94.5,94.55,94.6,94.4);b[79]=bar(79,94.55,95.1,95.2,94.5);
  }
  return b;
}
const reflect=b=>b.map(x=>({...x,open:200-x.open,close:200-x.close,high:200-x.low,low:200-x.high}));
for(const id of ['fractal-breakout','failed-breakout'])test(id+' confirms closed BUY/SELL, original levels and ordered router access',()=>{
  const side=id==='failed-breakout'?'SELL':'BUY';
  for(const [b,expected] of [[fixture(id),side],[reflect(fixture(id)),side==='BUY'?'SELL':'BUY']]){
    const s=signal(b,id),dir=expected==='BUY'?1:-1;
    assert.equal(s.side,expected);assert.equal(routeStrategy(b).strategy,id);
    assert.ok(dir*(s.entry-s.stop)>0&&dir*(s.target-s.entry)>0);assert.equal(s.riskModel,'structure');
    const forming={...b.at(-1),closed:false,time:new Date(start+80*900000).toISOString()};assert.deepEqual(signal([...b,forming],id),s);
    const gap=b.map(x=>({...x}));gap[78].time=new Date(start+78.5*900000).toISOString();assert.equal(signal(gap,id).side,'HOLD');
  }
});
test('fractal cannot use a pivot before its two right-hand candles exist, or a tied extremum',()=>{
  const b=fixture('fractal-breakout');assert.equal(indicators(b).fractalHigh,95);
  assert.notEqual(signal(b.slice(0,78),'fractal-breakout').side,'BUY');
  const tied=b.map(x=>({...x}));tied[77].high=95;assert.equal(indicators(tied).fractalHigh,null);assert.equal(signal(tied,'fractal-breakout').side,'HOLD');
  const changed=b.map(x=>({...x}));changed[79].high=150;assert.equal(indicators(changed).fractalHigh,95);
});
test('failed breakout requires a close beyond the older channel, rather than just a wick',()=>{
  const b=fixture('failed-breakout');assert.equal(indicators(b).failedBreakHigh,101);
  b[78].close=100.95;assert.equal(signal(b,'failed-breakout').side,'HOLD');
});
test('costed backtest censors an open trade across a missing candle rather than inventing an exit',()=>{
  const b=fixture('nr7-breakout'),entry=bar(80,95.1,95.15,95.2,95),gap=bar(82,95.15,99,100,94.9);
  const report=backtest([...b,entry,gap],'nr7-breakout',{start:60,feeBps:0,slippageBps:0});
  assert.equal(report.censored,1);assert.equal(report.n,0);assert.equal(report.winRate,null);
  const contiguous={...gap,time:new Date(start+81*900000).toISOString()};assert.equal(backtest([...b,entry,contiguous],'nr7-breakout',{feeBps:0,slippageBps:0}).n,1);
});
test('forming bars cannot enter backtest outcomes or change previous results',()=>{
  const b=fixture('nr7-breakout'),extra={...bar(80,95.1,99,100,94.9),closed:false};
  assert.deepEqual(backtest([...b,extra],'nr7-breakout'),backtest(b,'nr7-breakout'));
});
test('diagnostics expose all simultaneous blocks and keep unknown model evidence unknown',()=>{
  const market={symbol:'BTC/USD',live:false,feed:{status:'stale'},decision:{side:'HOLD',reason:'Objectif atteint',filteredByFreshness:true,filteredByH1:true,route:{higherTimeframe:{available:true,direction:'DOWN'}},confidenceGate:{candidateSide:'BUY',candidatePercent:60},executionPlan:{filteredByLevels:true,filteredByPrice:true,filteredByCosts:true},filteredByModelEvidence:true,modelAssessment:{passed:false,reason:'Modèle non retenu'}}};
  const before=structuredClone(market),r=decisionDiagnostics(market);assert.deepEqual(market,before);assert.equal(r.ready,false);assert.equal(r.checks.length,7);
  for(const id of ['feed','h1','model','confidence','levels','costs'])assert.equal(r.checks.find(c=>c.id===id).status,'blocked');
  assert.equal(decisionDiagnostics({symbol:'NDX'}).checks.find(c=>c.id==='model').status,'unavailable');
});
test('diagnostics preserve valid BUY/SELL and do not equate unavailable H1 with an opposing trend',()=>{
  for(const side of ['BUY','SELL']){
    const r=decisionDiagnostics({symbol:'EUR/USD',live:true,decision:{side,confidenceGate:{candidateSide:side,candidatePercent:80},modelAssessment:{passed:true},executionPlan:{valid:true},route:{higherTimeframe:{available:false}}}});
    assert.equal(r.ready,true);assert.equal(r.side,side);assert.equal(r.blockingCount,0);assert.equal(r.checks.find(c=>c.id==='h1').status,'unavailable');
  }
});
test('400 deterministic execution cases preserve levels and use independently calculated net rewards',()=>{
  for(let i=1;i<=200;i++)for(const side of ['BUY','SELL']){
    const dir=side==='BUY'?1:-1,entry=50+i/3,risk=.5+i/100,feeBps=i%11,slippageBps=i%7;
    const s={side,entry,stop:entry-dir*risk,target:entry+dir*risk*2,atr:risk*2};
    const p=executionPlan(s,{price:entry},{feeBps,slippageBps});assert.equal(p.valid,true);
    assert.equal(p.stop,s.stop);assert.equal(p.target,s.target);
    const fill=entry*(1+dir*slippageBps/10000),targetFill=s.target*(1-dir*slippageBps/10000);
    assert.ok(Math.abs(p.netReward-(dir*(targetFill-fill)-(fill+targetFill)*feeBps/10000))<1e-10);
    const crossed=executionPlan(s,{price:s.target},{feeBps,slippageBps});assert.equal(crossed.valid,false);
  }
});
