import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateClosedBars,buildMarketAnalysis,summarizeStrategies} from '../src/market-analysis.mjs';
const step=900000,start=Date.UTC(2025,0,1);
const fixture=(length=720)=>({timeframe:15,bars:Array.from({length},(_,i)=>({time:new Date(start+i*step).toISOString(),open:100+i,high:101+i,low:99+i,close:100.5+i,closed:true,volume:0}))});
const ending=d=>Date.parse(d.bars.at(-1).time)+step;
test('UTC aggregation omits partial edge groups and preserves independent OHLC expectations',()=>{
 const data=fixture(8),bars=data.bars.map((b,i)=>({...b,timeMs:start+(i+1)*step}));
 const result=aggregateClosedBars(bars,60);assert.equal(result.length,1);
 assert.deepEqual(result[0],{time:'2025-01-01T01:00:00.000Z',timeMs:start+3600000,open:103,high:107,low:102,close:106.5,closed:true});
 assert.throws(()=>aggregateClosedBars(bars,30),/Unsupported/);
});
test('720 closed quarter-hours produce 180 hour and 45 four-hour bars without volume',()=>{
 const data=fixture(),report=buildMarketAnalysis(data,{asOf:ending(data)});
 assert.equal(report.status,'ready');assert.deepEqual(report.frames.map(f=>f.bars),[720,180,45]);
 assert.ok(report.frames.every(f=>f.direction==='up'&&f.status==='ready'));
 assert.equal(report.frames[0].support,798);assert.equal(report.frames[0].resistance,819);
 assert.equal(report.frames[0].breakout,'above');assert.equal(report.closedBars,720);
 assert.equal(report.referenceTime,new Date(ending(data)).toISOString());assert.deepEqual(report,JSON.parse(JSON.stringify(report)));
});
test('short larger timeframes remain insufficient and never masquerade as mixed or aligned',()=>{
 const data=fixture(30),report=buildMarketAnalysis(data,{asOf:ending(data)});
 assert.equal(report.frames[0].status,'ready');assert.equal(report.frames[1].direction,'unavailable');assert.equal(report.frames[2].status,'insufficient');
});
test('future and forming appendages cannot change multi-timeframe analysis at a fixed cutoff',()=>{
 const data=fixture(),asOf=ending(data),expected=buildMarketAnalysis(data,{asOf});
 for(const b of [{...data.bars.at(-1),time:new Date(asOf).toISOString(),high:1e10,close:1e10},{closed:false,time:'not-a-date'}])assert.deepEqual(buildMarketAnalysis({...data,bars:[...data.bars,b]},{asOf}),expected);
 for(const change of [d=>d.bars[80].high=1,d=>d.bars[80].time='2025-02-30T00:00:00Z']){const broken=structuredClone(data);change(broken);assert.equal(buildMarketAnalysis(broken,{asOf}).status,'insufficient');}
 assert.equal(buildMarketAnalysis(data,{asOf:NaN}).reason,'invalid-as-of');
});
test('older gaps preserve only the latest continuous segment and never stitch missing candles',()=>{
 const data=fixture(),asOf=ending(data);data.bars.splice(80,1);const result=buildMarketAnalysis(data,{asOf});
 assert.equal(result.status,'ready');assert.equal(result.gaps,1);assert.equal(result.discardedBars,80);assert.equal(result.closedBars,639);
 assert.deepEqual(result.frames.map(f=>f.bars),[639,159,39]);
 const duplicated=fixture();duplicated.bars[80]={...duplicated.bars[79]};assert.equal(buildMarketAnalysis(duplicated,{asOf}).reason,'non-contiguous-history');
});
test('analysis bounds history to 720 without mutating source bars',()=>{
 const data=fixture(1000),before=structuredClone(data),asOf=ending(data);
 assert.deepEqual(buildMarketAnalysis(data,{asOf}),buildMarketAnalysis({...data,bars:data.bars.slice(-720)},{asOf}));assert.deepEqual(data,before);
});
test('strategy summary separates missing data, conflicts and partial conditions without vote probabilities',()=>{
 const rules=[{id:'a',family:'trend',side:'BUY'},{id:'a',family:'trend',side:'BUY'},{id:'b',family:'trend',side:'SELL'},{id:'c',family:'volume',side:'BUY',dataReady:false},
 {id:'d',name:'Partial',family:'reversion',side:'HOLD',directionalChecks:{BUY:[{label:'Present',passed:true},{label:'Missing',passed:false}],SELL:[{label:'Absent',passed:false}]}}];
 const result=summarizeStrategies(rules);
 assert.equal(result.total,4);assert.equal(result.buy,1);assert.equal(result.sell,1);assert.equal(result.blocked,1);assert.equal(result.waiting,1);assert.equal(result.conflict,true);
 assert.deepEqual(result.nearest,[{id:'d',name:'Partial',family:'reversion',side:'BUY',met:1,total:2,missing:['Missing']}]);
 assert.equal(result.families.find(f=>f.id==='volume').buy,0);assert.ok(!Object.hasOwn(result,'confidence'));assert.deepEqual(result,JSON.parse(JSON.stringify(result)));
});
