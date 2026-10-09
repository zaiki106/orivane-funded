import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {strategyEvidence} from '../src/strategy-evidence.mjs';
import {laboratory,backtest,metrics} from '../src/engine.mjs';

const cost={feeBps:2,slippageBps:2,assumption:true};
function tradesFor(returns){return returns.map((r,i)=>({strategy:'breakout',r,time:new Date(Date.UTC(2026,0,1)+i*3600000).toISOString(),exitTime:new Date(Date.UTC(2026,0,1)+i*3600000+900000).toISOString()}));}
function fixture(returns=[2,-1,0,-1]){
  const trades=tradesFor(returns),result={id:'breakout',name:'Cassure',cost:{...cost},train:{n:100,winRate:99},validation:{n:100,winRate:98},test:{...metrics(trades),trades}};
  return {symbol:'EUR/USD',source:'Deterministic historical fixture',from:'2020-01-01T00:00:00Z',to:'2026-02-01T00:00:00Z',selected:'unrelated',results:[result]};
}

test('reports only independently checked net test results and actual closed-trade coverage',()=>{
  const lab=fixture();
  // Hand-calculated four returns: one win, two losses, one flat; equity 2,1,1,0.
  lab.results[0].test={n:4,wins:1,winRate:25,winInterval:[4.558606264463622,69.93639475573634],expectancy:0,totalR:0,profitFactor:1,maxDrawdownR:2,trades:tradesFor([2,-1,0,-1])};
  const before=structuredClone(lab),report=strategyEvidence(lab,'breakout');
  assert.equal(report.status,'insufficient');assert.equal(report.partition,'test');
  assert.equal(report.sample,4);assert.equal(report.wins,1);assert.equal(report.winRate,25);
  assert.equal(report.expectancy,0);assert.equal(report.totalR,0);assert.equal(report.profitFactor,1);assert.equal(report.maxDrawdownR,2);
  assert.deepEqual(report.winInterval,[4.558606264463622,69.93639475573634]);
  assert.deepEqual(report.cost,cost);assert.equal(report.tradeFrom,'2026-01-01T00:00:00.000Z');assert.equal(report.tradeTo,'2026-01-01T03:15:00.000Z');
  assert.equal(report.coverage,'closed-test-trades');assert.equal(report.minimumSample,20);
  for(const key of ['train','validation','trades','confidence','selected','from','to'])assert.equal(Object.hasOwn(report,key),false,key+' must not leak or mislabel the final test');
  assert.deepEqual(lab,before,'Reporting does not change selection or any laboratory input');
  report.cost.feeBps=99;report.winInterval[0]=0;
  assert.deepEqual(lab,before,'Public nested values do not alias the model laboratory');
});

test('sample boundary is explicit and zero trades never become a zero or perfect win rate',()=>{
  assert.equal(strategyEvidence(fixture(Array(19).fill(.5)),'breakout').status,'insufficient');
  const available=strategyEvidence(fixture(Array(20).fill(.5)),'breakout');
  assert.equal(available.status,'available');assert.equal(available.sample,20);assert.equal(available.wins,20);assert.equal(available.winRate,100);assert.equal(available.profitFactor,null);
  const empty=strategyEvidence(fixture([]),'breakout');
  assert.equal(empty.status,'insufficient');assert.equal(empty.sample,0);assert.equal(empty.wins,0);
  for(const key of ['winRate','winInterval','expectancy','profitFactor','tradeFrom','tradeTo'])assert.equal(empty[key],null,key);
  assert.equal(empty.totalR,0);assert.equal(empty.maxDrawdownR,0);
});

test('missing, unknown, duplicate, stale and malformed laboratories fail closed',()=>{
  const cases=[null,{}, {...fixture(),results:null},{...fixture(),stale:true},{...fixture(),status:'stale'},{...fixture(),status:'error'}];
  const duplicate=fixture();duplicate.results.push(structuredClone(duplicate.results[0]));cases.push(duplicate);
  for(const lab of cases){const report=strategyEvidence(lab,'breakout');assert.equal(report.status,'unavailable');assert.equal(report.sample,null);assert.equal(report.winRate,null);assert.equal(report.tradeFrom,null);}
  for(const id of ['missing','',null])assert.equal(strategyEvidence(fixture(),id).status,'unavailable');
  const noCost=fixture();delete noCost.results[0].cost;assert.equal(strategyEvidence(noCost,'breakout').status,'unavailable');
  const invalidCost=fixture();invalidCost.results[0].cost.slippageBps=-1;assert.equal(strategyEvidence(invalidCost,'breakout').status,'unavailable');
});

test('invalid and internally inconsistent test statistics cannot be published',()=>{
  const changes=[
    metric=>{metric.n=-1;},metric=>{metric.n=3.5;},metric=>{metric.wins=5;},
    metric=>{metric.winRate=100;},metric=>{metric.winInterval=[-1,101];},metric=>{metric.winInterval=[30,40];},
    metric=>{metric.expectancy=.5;},metric=>{metric.totalR=NaN;},metric=>{metric.profitFactor=Infinity;},
    metric=>{metric.maxDrawdownR=-1;},metric=>{metric.maxDrawdownR=0;},metric=>{metric.trades.pop();},
    metric=>{metric.trades[0].r=Infinity;},metric=>{metric.trades[0].exitTime='not-a-date';},
    metric=>{metric.trades[0].exitTime='2025-01-01T00:00:00Z';},metric=>{metric.trades[0].strategy='vwap';}
  ];
  for(const change of changes){const lab=fixture();change(lab.results[0].test);const report=strategyEvidence(lab,'breakout');assert.equal(report.status,'unavailable',change.toString());assert.equal(report.winRate,null);assert.equal(report.expectancy,null);}
});

test('actual laboratory report agrees with causal net-cost backtest of the untouched final partition',()=>{
  const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url))),lab=laboratory(dataset),chosen='breakout';
  const report=strategyEvidence(lab,chosen),expected=backtest(dataset.bars,chosen,{...cost,start:Math.floor(dataset.bars.length*.75)});
  assert.notEqual(report.status,'unavailable');assert.ok(expected.n>0);
  assert.equal(report.sample,expected.trades.length);assert.equal(report.wins,expected.trades.filter(t=>t.r>0).length);
  assert.equal(report.winRate,100*report.wins/report.sample);
  const netR=expected.trades.reduce((sum,trade)=>sum+trade.r,0);
  assert.equal(report.totalR,netR);assert.equal(report.expectancy,netR/expected.n);assert.deepEqual(report.cost,cost);
  assert.ok(expected.trades.every(trade=>trade.index>=Math.floor(dataset.bars.length*.75)));
  assert.equal(report.tradeFrom,new Date(expected.trades[0].time).toISOString());assert.equal(report.tradeTo,new Date(expected.trades.at(-1).exitTime).toISOString());
  const prefix=dataset.bars.slice(0,500),altered=structuredClone(dataset.bars);
  for(let i=500;i<altered.length;i++)for(const key of ['open','high','low','close'])altered[i][key]*=3;
  const boundedLab={results:[{id:chosen,name:'Cassure',cost,test:backtest(dataset.bars,chosen,{...cost,start:375,end:500})}]};
  const futureChangedLab={results:[{id:chosen,name:'Cassure',cost,test:backtest(altered,chosen,{...cost,start:375,end:500})}]};
  assert.deepEqual(strategyEvidence(boundedLab,chosen),strategyEvidence(futureChangedLab,chosen),'Unseen later prices cannot alter the report for a completed fixed test window');
  assert.deepEqual(backtest(prefix,chosen,{...cost,start:375}),boundedLab.results[0].test);
});
