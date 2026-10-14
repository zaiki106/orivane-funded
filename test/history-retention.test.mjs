import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeHistory,readHistory,saveHistory} from '../src/history-store.mjs';
const bar=(time,close)=>({time:new Date(time*900000).toISOString(),close});
const dataset=bars=>({symbol:'EUR/USD',source:'Deriv',timeframe:15,receivedAt:new Date().toISOString(),bars});
test('provider refresh retains older real candles, accepts revisions and excludes forming bars',()=>{
  const prior=dataset([bar(1,1),bar(2,2)]),incoming=dataset([bar(2,2.1),bar(4,4),{...bar(5,5),closed:false}]);
  assert.deepEqual(mergeHistory(prior,incoming),[bar(1,1),bar(2,2.1),bar(4,4)]);
  assert.deepEqual(mergeHistory(prior,incoming,2),[bar(2,2.1),bar(4,4)]);
});
test('prices from another source, timeframe or symbol cannot enter the history',()=>{
  const incoming=dataset([bar(4,4)]),prior=dataset([bar(1,1)]);
  for(const changed of [{source:'Yahoo'},{timeframe:60},{symbol:'GBP/USD'}])assert.deepEqual(mergeHistory({...prior,...changed},incoming),incoming.bars);
});
test('cache unavailability never fabricates data or prevents live provider access',async()=>{
  assert.deepEqual(await readHistory(),[]);assert.equal(await saveHistory(dataset([])),false);
});
