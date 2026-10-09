import test from 'node:test';
import assert from 'node:assert/strict';
import {signal} from '../src/engine.mjs';
import {routeStrategy,decide,classes,featureNames,featureWindow,decisionVersion} from '../src/decision.mjs';
const candles=values=>values.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(close,values[i-1]??close)+.1,low:Math.min(close,values[i-1]??close)-.1,close,volume:0}));
const trend=()=>candles([...Array(60).fill(100),...Array.from({length:40},(_,i)=>100+(i+1)*.2)]);
const fixtures={donchian55:trend(),'adx-continuation':trend(),ichimoku:trend(),'cci-recovery':candles([...Array(60).fill(100),96,101.2]),aroon:candles([...Array(80).fill(100),106]),'roc-momentum':candles([...Array(80).fill(100),100.6])};
fixtures['adx-continuation'].at(-10).high=110;
fixtures.ichimoku.at(-10).high=110;fixtures.ichimoku.at(-2).low-=1;
fixtures.aroon.at(-26).high=105;fixtures.aroon.at(-19).low=95;
// Keep the range obstruction outside the Fisher 10-window so this fixture
// isolates the ROC transition rather than a simultaneous oscillator recovery.
fixtures['roc-momentum'].at(-20).high=105;
const reflected=bars=>bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
const model=side=>({version:decisionVersion,classes:[...classes],featureWindow,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:(side==='BUY'?[.8,.1,.1]:[.1,.8,.1]).map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}});

for(const [id,bars] of Object.entries(fixtures))test(id+' is reachable in both directions through the actual router and confidence gate',()=>{
  for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    assert.equal(signal(input,id).side,side,'The fixture first establishes the rule independently of routing');
    assert.equal(routeStrategy(input).strategy,id,'The rule must be operational, not just listed in the catalogue');
    const result=decide(input,model(side));assert.equal(result.side,side);assert.equal(result.strategy,id);assert.equal(result.confidence.percent,80);
    const blocked=decide(input,{...model(side),weights:[.2,.2,.6].map(p=>[Math.log(p),...Array(featureNames.length).fill(0)])});
    assert.equal(blocked.side,'HOLD');assert.equal(blocked.filteredByConfidence,true);assert.equal(blocked.stop,null);assert.equal(blocked.target,null);
    const forming={...input.at(-1),time:new Date(Date.parse(input.at(-1).time)+900000).toISOString(),closed:false,high:500,low:1,close:400};
    assert.deepEqual(decide([...input,forming],model(side)),result);
  }
});

test('an extreme but valid price collapse cannot publish nonpositive execution levels',()=>{
  const bars=candles([...Array(80).fill(100),.01]);bars.at(-1).low=.005;
  const raw=signal(bars,routeStrategy(bars).strategy);assert.equal(raw.side,'SELL');assert.ok(raw.target<=0);
  const decision=decide(bars,model('SELL'));
  assert.equal(decision.side,'HOLD');assert.equal(decision.filteredByLevels,true);
  assert.equal(decision.entry,null);assert.equal(decision.stop,null);assert.equal(decision.target,null);assert.equal(decision.setup.confirmed,false);
  assert.equal(decision.setup.stop,null);assert.equal(decision.setup.target,null);assert.equal(decision.setup.invalidation,null);assert.equal(decision.invalidation,null);
});
