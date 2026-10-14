import {createSyntheticMarketFixture} from './helpers/synthetic-market-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {backtest} from '../src/engine.mjs';
const bars=createSyntheticMarketFixture().bars.slice(0,130);
test('closed-history contexts are reused across strategies without changing trades',()=>{
  const cache={bars,values:new Map()};
  for(const strategy of ['continuation','ema-cross','breakout']){
    const plain=backtest(bars,strategy),cached=backtest(bars,strategy,{contextCache:cache});
    assert.deepEqual(cached,plain);
  }
  assert.ok(cache.values.size>0,'shared indicator cache must be populated');
  const first=[...cache.values.entries()];
  backtest(bars,'continuation',{contextCache:cache});
  for(const [index,value] of first)assert.equal(cache.values.get(index),value);
});
test('forming candles cannot reuse a cache belonging to a different closed prefix',()=>{
  const forming={...bars.at(-1),time:new Date(Date.parse(bars.at(-1).time)+900000).toISOString(),closed:false};
  const input=[...bars,forming],cache={bars:input,values:new Map([[60,{invalid:true}]])};
  assert.deepEqual(backtest(input,'continuation',{contextCache:cache}),backtest(bars,'continuation'));
});
