import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {routeStrategy,decide} from '../src/decision.mjs';
import {signal} from '../src/engine.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/routing-completeness.synthetic.json',import.meta.url)));
// Each independent test path starts at a fixed price and uses only this seeded
// LCG recipe. No provider candles, learned models or market probabilities exist.
function syntheticBars(seed,variant){
  let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const mode=seed%7,drift=(seed%13-6)*.07,sigma=.35+(seed%11)*.1,frequency=.04+(seed%9)*.055,start=Date.parse(fixture.recipe.start);let previous=fixture.recipe.basePrice;
  const bars=Array.from({length:fixture.recipe.bars},(_,i)=>{
    const shock=(random()+random()+random()-1.5)*sigma*(i>154?1+(seed%5):1),open=previous,close=Math.max(50,open+drift+Math.sin(i*frequency)*sigma*.6+shock),wick=.02+random()*sigma*.9,volume=mode===0?0:Math.round(100*(.2+3*random())*(i===159&&seed%3===0?3:1));previous=close;
    return {time:new Date(start+i*fixture.recipe.intervalMs).toISOString(),open,high:Math.max(open,close)+wick,low:Math.min(open,close)-wick,close,volume,closed:true,synthetic:true};
  });
  // Deliberate test geometry: a doji with a deep lower wick, followed by a
  // tiny upward body. This distinguishes pullback from body-filtered rules.
  if(variant==='tiny-body-pullback'){
    const previous=bars.at(-2),last=bars.at(-1);previous.open=previous.close;previous.high=previous.close+.001;previous.low=previous.close-5;
    last.open=previous.close;last.close=previous.close+.01;last.high=last.close+.005;last.low=last.open-.005;
  }
  return bars;
}
test('routing fixture is explicitly synthetic, test-only and unavailable to training or deployment',()=>{
  assert.equal(fixture.synthetic,true);assert.equal(fixture.testOnly,true);assert.equal(fixture.trainingAllowed,false);assert.equal(fixture.deploymentAllowed,false);
  assert.ok(fixture.cases.length>=4);assert.ok(fixture.cases.every(sample=>!Object.hasOwn(sample,'bars')&&Number.isSafeInteger(sample.seed)));
});
for(const sample of fixture.cases)test(`Synthetic router retains ${sample.expected} on ${sample.symbol}, seed ${sample.seed}`,()=>{
  const bars=syntheticBars(sample.seed,sample.variant),route=routeStrategy(bars);
  assert.equal(route.preferredStrategy,sample.preferredStrategy);
  assert.equal(signal(bars,route.preferredStrategy).side,'HOLD');
  assert.equal(route.setupPresent,true);
  assert.equal(route.strategy,sample.expected);
  assert.equal(signal(bars,route.strategy).side,sample.side);
  // A technical trigger alone must never bypass the user's probability requirement.
  const decision=decide(bars,null,{fresh:true,symbol:sample.symbol});
  assert.equal(decision.side,'HOLD');
  assert.ok(['BUY','SELL'].includes(decision.confidenceGate.candidateSide));
  assert.equal(decision.confidenceGate.passed,false);
});
