import test from 'node:test';import assert from 'node:assert/strict';import {cacheUsable,mergeHistory,derivCacheTTL} from '../public/core/history-store.mjs';
test('Deriv caching expires relative to the original request, not repeated saves',()=>{
  const request=Date.UTC(2026,9,13),d={source:'Deriv public · forex',requestedAt:new Date(request).toISOString()};
  assert.equal(cacheUsable(d,request+derivCacheTTL-1),true);assert.equal(cacheUsable({...d,savedAt:new Date(request+derivCacheTTL).toISOString()},request+derivCacheTTL),false);
  assert.equal(cacheUsable({source:d.source},request),false);assert.equal(cacheUsable({source:'Kraken public · spot'},request),true);
});
test('expired restricted cache is not merged into a fresh provider history',()=>{
  const common={symbol:'EUR/USD',source:'Deriv public · forex',timeframe:15},old={...common,receivedAt:'2020-01-01',bars:[{time:'2020-01-01',close:1}]},fresh={...common,receivedAt:new Date().toISOString(),bars:[{time:'2026-01-01',close:2}]};
  assert.deepEqual(mergeHistory(old,fresh),fresh.bars);
});
