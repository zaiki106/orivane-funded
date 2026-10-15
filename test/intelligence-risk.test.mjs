import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioRisk,allocateResearchRisk} from '../src/intelligence-risk.mjs';
const history = (values, offset=0) => values.map((value,i)=>({timeMs:i+offset,value}));
const position = (id,symbol,side='BUY') => ({id,symbol,side,entry:100,stop:side==='BUY'?95:105,quantity:2});
test('stop risk and synchronized signed scenarios match monetary arithmetic',()=>{
 const r=portfolioRisk([position('a','A'),position('b','B','SELL')],{A:history([.1,-.1,.05]),B:history([.02,.03,-.02])},{equity:1000,minSamples:2});
 assert.equal(r.totalStopRisk,20);assert.equal(r.totalStopRiskPercent,2);
 assert.deepEqual(r.scenarios.losses.map(x=>x.loss),[-16,26,-14]);
 assert.equal(r.scenarios.expectedShortfall95,26);assert.equal(r.realTradingAuthorized,false);
});
test('95% empirical tail uses worst ceil(5% N) synchronized losses',()=>{
 const r=portfolioRisk([position('a','A')],{A:history(Array.from({length:40},(_,i)=>-i/100))},{equity:1000});
 assert.equal(r.scenarios.tailSample,2);assert.equal(r.scenarios.valueAtRisk95,74);
 assert.equal(r.scenarios.expectedShortfall95,77);
});
test('alignment, missing evidence and constant correlations are explicit',()=>{
 const r=portfolioRisk([position('a','A'),position('b','B')],{A:history([1,2,3]),B:history([1,2,3],10)},{equity:1000,minSamples:2});
 assert.equal(r.status,'insufficient');assert.equal(r.pairCorrelations[0].sample,0);assert.equal(r.scenarios.expectedShortfall95,null);
 const c=portfolioRisk([position('a','A'),position('b','B')],{A:history([0,0,0]),B:history([1,2,3])},{equity:1000,minSamples:2});
 assert.equal(c.pairCorrelations[0].correlation,null);assert.equal(c.pairCorrelations[0].reason,'constant-series');
});
test('same-side short correlation accumulates exposure; opposite sides never erase stop risk',()=>{
 const returns={A:history([.1,-.1,.2]),B:history([.2,-.2,.4])};
 const r=portfolioRisk([position('a','A','SELL'),position('b','B','SELL')],returns,{equity:1000,minSamples:2,maxTotalRiskPercent:1,maxSymbolRiskPercent:.5});
 assert.equal(r.correlatedClusters[0].riskPercent,2);assert.ok(r.violations.some(v=>v.code==='TOTAL_RISK_LIMIT'));
 assert.ok(r.violations.some(v=>v.code==='SYMBOL_RISK_LIMIT'));assert.ok(r.violations.some(v=>v.code==='CORRELATED_EXPOSURE'));
 const opposite=portfolioRisk([position('a','A'),position('b','A','SELL')],returns,{equity:1000,minSamples:2});
 assert.equal(opposite.totalStopRisk,20);assert.equal(opposite.correlatedClusters.length,0);
});
test('invalid inputs cannot silently generate risk numbers',()=>{
 for(const positions of [[position('a','A'),position('a','B')],[{...position('a','A'),stop:110}],[{...position('a','A'),quantity:NaN}]])assert.throws(()=>portfolioRisk(positions,{}, {equity:1000}));
 assert.throws(()=>portfolioRisk([], {A:history([1,NaN])},{equity:1000}));
 assert.throws(()=>portfolioRisk([], {A:[{timeMs:1,value:0},{timeMs:1,value:.1}]},{equity:1000}));
 assert.throws(()=>portfolioRisk([], {},{equity:0}));
});
test('allocation excludes weak and concentrated evidence and caps actual budget',()=>{
 const candidates=[{id:'a',symbol:'A',side:'BUY'},{id:'b',symbol:'B',side:'BUY'},{id:'c',symbol:'C',side:'BUY'}];
 const r=allocateResearchRisk(candidates,{A:history([.1,-.1,.2]),B:history([.2,-.2,.4]),C:history([.1])},{minSamples:2,budgetPercent:2,maxWeight:.4});
 assert.equal(r.allocations.find(a=>a.id==='a').weight,.4);
 assert.ok(r.allocations.find(a=>a.id==='b').reasons.includes('same-side-correlated'));
 assert.ok(r.allocations.find(a=>a.id==='c').reasons.includes('insufficient-samples'));
 assert.equal(r.allocatedRiskPercent,.8);assert.equal(r.unallocatedRiskPercent,1.2);
 assert.equal(r.realTradingAuthorized,false);
});
test('allocation inverse volatility preserves caps and cannot use duplicate strategies',()=>{
 const c=[{id:'a',symbol:'A',side:'BUY'},{id:'b',symbol:'B',side:'SELL'}];
 const r=allocateResearchRisk(c,{A:history([.1,-.1,.2]),B:history([.2,-.2,.4])},{minSamples:2,maxWeight:.8});
 assert.ok(Math.abs(r.allocations[0].weight-2/3)<1e-12);assert.ok(Math.abs(r.allocations[1].weight-1/3)<1e-12);
 assert.throws(()=>allocateResearchRisk([c[0],c[0]],{}));
 const d=allocateResearchRisk([c[0],{...c[0],id:'other'}],{A:history([.1,-.1,.2])},{minSamples:2});
 assert.equal(d.allocations.filter(a=>a.weight>0).length,1);
});
test('contract multipliers and exact threshold boundaries are accounted for',()=>{
 const r=portfolioRisk([{...position('a','A'),contractMultiplier:10}],{A:history([-.1,.1])},{equity:10000,minSamples:2});
 assert.equal(r.totalStopRisk,100);assert.equal(r.totalStopRiskPercent,1);
 assert.deepEqual(r.scenarios.losses.map(p=>p.loss),[200,-200]);
 assert.equal(r.violations.length,0);
 assert.throws(()=>portfolioRisk([{...position('a','A'),contractMultiplier:null}],{}, {equity:1000}));
 for(const options of [{minSamples:1},{maxWeight:1.1},{budgetPercent:NaN}])assert.throws(()=>allocateResearchRisk([],{},options));
 assert.throws(()=>portfolioRisk([], {A:history([1,2]).reverse()},{equity:1000}));
});
test('allocator requires shared evidence and recognizes signed exposure concentration',()=>{
 const candidates=[{id:'a',symbol:'A',side:'BUY'},{id:'b',symbol:'B',side:'SELL'}];
 const missing=allocateResearchRisk(candidates,{A:history([.1,-.1,.2]),B:history([.2,-.2,.4],10)},{minSamples:2});
 assert.ok(missing.allocations[1].reasons.includes('insufficient-diversification-evidence'));
 const concentrated=allocateResearchRisk(candidates,{A:history([.1,-.1,.2]),B:history([-.2,.2,-.4])},{minSamples:2});
 assert.ok(concentrated.allocations[1].reasons.includes('opposite-side-anticorrelated'));
 const constant=allocateResearchRisk([candidates[0]],{A:history([.1,.1,.1])},{minSamples:2});
 assert.equal(constant.status,'insufficient');assert.equal(constant.unallocatedRiskPercent,2);
 assert.equal(constant.allocations[0].volatility,0);
});
