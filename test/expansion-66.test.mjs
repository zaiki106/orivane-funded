import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {signal,strategies} from '../src/engine.mjs';import {expansionStrategies} from '../src/expansion-strategies.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./helpers/expansion-66-fixtures.json',import.meta.url)));
test('the complete catalogue contains 66 unique executable rules',()=>{assert.equal(strategies.length,66);assert.equal(new Set(strategies.map(r=>r.id)).size,66);});
for(const rule of expansionStrategies)test(rule.id+' has real bullish and bearish triggers, fixed ordered levels and causal inputs',()=>{
 for(const side of ['BUY','SELL']){
  const b=fixtures[rule.id][side],s=signal(b,rule.id),dir=side==='BUY'?1:-1;
  assert.equal(s.side,side);assert.ok(s.checks.every(c=>c.passed));assert.ok(dir*(s.entry-s.stop)>0&&dir*(s.target-s.entry)>0);
  const scaled=b.map(x=>({...x,open:x.open*5,close:x.close*5,high:x.high*5,low:x.low*5}));assert.equal(signal(scaled,rule.id).side,side);
  const forming={...b.at(-1),closed:false,time:new Date(Date.parse(b.at(-1).time)+900000).toISOString(),close:900,high:901,low:1};assert.deepEqual(signal([...b,forming],rule.id),s);
 }
});
