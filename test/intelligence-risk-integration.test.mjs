import test from 'node:test';
import assert from 'node:assert/strict';
import {researchIntelligence} from '../src/intelligence-research.mjs';

const start=Date.parse('2024-01-01T00:00:00Z'),step=900000;
function dataset({jump=false,volume=true}={}){
 const bars=Array.from({length:360},(_,i)=>({time:new Date(start+i*step).toISOString(),open:100,high:101,low:99,close:100,...volume?{volume:100}:{},closed:true}));
 if(jump)Object.assign(bars.at(-1),{open:100,high:106,low:99.9,close:105.5,volume:200});
 return {symbol:'BTC/USD',source:'deterministic synthetic integration fixture',timeframe:15,synthetic:true,bars};
}
const asOf=start+360*step;
test('no latest setups produces an explicit empty allocation without crashing research',()=>{
 const r=researchIntelligence(dataset(),{asOf});
 assert.equal(r.testOnly,true);assert.ok(r.latestSetups.every(s=>s.side==='HOLD'));
 assert.equal(r.allocation.status,'insufficient');assert.deepEqual(r.allocation.allocations,[]);
 assert.equal(r.allocation.allocatedRiskPercent,0);assert.equal(r.allocation.unallocatedRiskPercent,2);
 assert.equal(r.policy.realTradingAuthorized,false);
});
test('unknown portfolio instruments preserve stop exposure and mark scenario evidence insufficient',()=>{
 const positions=[{id:'external',symbol:'EUR/USD',side:'SELL',entry:1.1,stop:1.11,quantity:100000}];
 const r=researchIntelligence(dataset(),{asOf,equity:10000,positions});
 assert.equal(r.portfolio.status,'insufficient');assert.equal(r.portfolio.scenarios.sample,0);
 assert.equal(r.portfolio.scenarios.expectedShortfall95,null);
 assert.ok(Math.abs(r.portfolio.totalStopRiskPercent-10)<1e-10);
 assert.ok(r.portfolio.violations.some(v=>v.code==='TOTAL_RISK_LIMIT'));
 assert.ok(r.portfolio.violations.some(v=>v.code==='SYMBOL_RISK_LIMIT'));
});
test('simultaneous latest strategies retain distinct ids but cannot multiply one instrument allocation',()=>{
 const r=researchIntelligence(dataset({jump:true}),{asOf});
 const active=r.latestSetups.filter(s=>s.side!=='HOLD');assert.ok(active.length>=2);
 assert.equal(new Set(r.allocation.allocations.map(c=>c.id)).size,active.length);
 assert.equal(r.allocation.allocations.filter(c=>c.weight>0).length,1);
 assert.ok(r.allocation.allocations.filter(c=>c.weight===0).every(c=>c.reasons.includes('duplicate-symbol')));
 assert.equal(r.allocation.allocatedRiskPercent,1);assert.equal(r.allocation.unallocatedRiskPercent,1);
 assert.equal(r.portfolio.realTradingAuthorized,false);assert.equal(r.allocation.realTradingAuthorized,false);
});
test('integration fails closed for invalid equity and invalid position stops',()=>{
 assert.throws(()=>researchIntelligence(dataset(),{asOf,equity:NaN}),/equity/);
 assert.throws(()=>researchIntelligence(dataset(),{asOf,positions:[{id:'p',symbol:'BTC/USD',side:'BUY',entry:100,stop:101,quantity:1}]}),/Stop/);
});
test('missing volume is excluded by all strategy contexts rather than fabricated',()=>{
 const r=researchIntelligence(dataset({volume:false}),{asOf});
 assert.equal(r.examples,0);assert.ok(r.latestSetups.every(s=>s.side==='HOLD'&&s.reason==='real-volume-required'));
 assert.equal(r.allocation.status,'insufficient');
});
