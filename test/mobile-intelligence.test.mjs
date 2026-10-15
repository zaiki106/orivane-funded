import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildMobileIntelligence} from '../src/mobile-intelligence.mjs';
import {createSyntheticMarketFixture} from './helpers/synthetic-market-fixture.mjs';
import {analyzeIntelligenceContext,signalFromIntelligenceContext,intelligenceStrategies} from '../src/intelligence-strategies.mjs';

const interval=900000;
const ending=dataset=>Date.parse(dataset.bars.at(-1).time)+interval;
const fixture=options=>createSyntheticMarketFixture(options);
const verifyNullLevels=result=>{assert.equal(result.status,'insufficient');assert.equal(result.activeSetups,0);assert.equal(result.strategies.length,6);
 for(const rule of result.strategies){assert.equal(rule.side,'HOLD');assert.equal(rule.entry,null);assert.equal(rule.stop,null);assert.equal(rule.target,null);assert.equal(rule.atr,null);}};

test('mobile intelligence fits real regime and PSI diagnostics entirely from existing synthetic test fixture',()=>{
 const data=fixture(),before=structuredClone(data),result=buildMobileIntelligence(data,{asOf:ending(data)});
 assert.equal(result.version,'mobile-intelligence-v1');assert.equal(result.status,'ready');assert.equal(result.reason,'ready');
 assert.equal(result.requiresPC,false);assert.equal(result.researchOnly,true);assert.equal(result.volumeStatus,'available');
 assert.equal(result.referenceTime,new Date(ending(data)).toISOString());assert.equal(result.regime.status,'estimated');
 assert.ok(Number.isFinite(result.regime.nearestDistance));assert.equal(result.drift.status,'measured');
 assert.ok(Number.isFinite(result.drift.maxPsi));assert.equal(result.training.featureNames.length,5);
 assert.ok(result.training.referenceSamples>=20);assert.ok(result.training.currentSamples>=20);
 assert.equal(result.training.referenceSamples,Math.floor((result.training.referenceSamples+result.training.currentSamples)*.7));
 assert.ok(Date.parse(result.training.referenceThrough)<Date.parse(result.training.currentFrom));
 assert.equal(result.training.referenceScaler.mean.length,5);assert.deepEqual(data,before);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 for(const rule of result.strategies){assert.equal(rule.researchOnly,true);assert.equal(Object.hasOwn(rule,'confidence'),false);assert.equal(Object.hasOwn(rule,'probability'),false);}
});

test('forming and future appendages cannot alter fixed-asOf strategy or historical diagnostics',()=>{
 const data=fixture(),asOf=ending(data),expected=buildMobileIntelligence(data,{asOf});
 const next={...data.bars.at(-1),time:new Date(asOf).toISOString(),open:1,high:1e10,low:.001,close:1e9,volume:1e12};
 for(const appendage of [{...next,closed:false},next,{...next,time:new Date(asOf+20*interval).toISOString()},
  {...next,close:Infinity},{closed:false,time:'not-a-date'}]){
  assert.deepEqual(buildMobileIntelligence({...data,bars:[...data.bars,appendage]},{asOf}),expected);
 }
});

test('recent modifications cannot change reference-fitted scaler or PSI boundaries',()=>{
 const original=fixture(),modified=structuredClone(original),asOf=ending(original),baseline=buildMobileIntelligence(original,{asOf});
 for(let i=600;i<modified.bars.length;i++){
  const bar=modified.bars[i],factor=1+(i-599)*.0005;
  for(const name of ['open','high','low','close'])bar[name]*=factor;
  bar.volume*=3;
 }
 const current=buildMobileIntelligence(modified,{asOf});
 assert.equal(current.status,'ready');assert.deepEqual(current.training,baseline.training);
 assert.deepEqual(current.drift.features.map(row=>row.boundaries),baseline.drift.features.map(row=>row.boundaries));
 assert.notEqual(current.drift.maxPsi,baseline.drift.maxPsi);
});

test('all six current recipes share completed context and active count matches their genuine setups',()=>{
 const data=fixture(),last=data.bars.at(-1),channelHigh=Math.max(...data.bars.slice(-56,-1).map(bar=>bar.high));
 last.close=channelHigh+5;last.high=Math.max(last.open,last.close)+.5;last.low=Math.min(last.open,last.close)-.5;
 const asOf=ending(data),result=buildMobileIntelligence(data,{asOf}),context=analyzeIntelligenceContext(data.bars,{nowMs:asOf});
 const donchian=result.strategies.find(rule=>rule.id==='intel-donchian55');assert.equal(donchian.side,'BUY');assert.ok(donchian.entry>channelHigh);
 assert.equal(result.strategies.length,6);assert.ok(result.activeSetups>0);
 assert.equal(result.activeSetups,result.strategies.filter(rule=>rule.side!=='HOLD').length);
 for(const rule of intelligenceStrategies){
  const expected=signalFromIntelligenceContext(context,rule.id),actual=result.strategies.find(row=>row.id===rule.id);
  for(const key of ['side','entry','stop','target','atr','reason'])assert.deepEqual(actual[key],expected[key]);
  if(actual.side!=='HOLD'){
   const direction=actual.side==='BUY'?1:-1;
   assert.ok(Math.abs(actual.stop-(actual.entry-direction*1.5*actual.atr))<1e-10);
   assert.ok(Math.abs(actual.target-(actual.entry+direction*1.5*actual.atr*rule.parameters.targetR))<1e-10);
  }
 }
});

test('no setup and insufficient diagnostic samples are valid ready strategy contexts',()=>{
 const data=fixture();data.bars=data.bars.map(bar=>({...bar,open:100,high:101,low:99,close:100,volume:100}));
 const result=buildMobileIntelligence(data,{asOf:ending(data)});
 assert.equal(result.status,'ready');assert.equal(result.activeSetups,0);assert.equal(result.regime.status,'insufficient');
 assert.equal(result.regime.reason,'constant_features');assert.ok(result.strategies.every(rule=>rule.reason==='setup-not-confirmed'));
 const short=fixture({length:120}),limited=buildMobileIntelligence(short,{asOf:ending(short)});
 assert.equal(limited.status,'ready');assert.equal(limited.drift.status,'insufficient');assert.equal(limited.reason,'context-ready-diagnostics-insufficient');
});

test('missing FX volume, fake volume and invalid numeric volume fail explicitly without trade levels',()=>{
 for(const change of [bar=>{delete bar.volume;},bar=>{bar.volume=0;},bar=>{bar.volumeUnavailable=true;},bar=>{bar.syntheticVolume=true;}]){
  const data=fixture();data.symbol='EUR/USD';change(data.bars[50]);
  const result=buildMobileIntelligence(data,{asOf:ending(data)});verifyNullLevels(result);
  assert.equal(result.reason,'real-volume-required');assert.equal(result.volumeStatus,'unavailable');
 }
 for(const volume of [-1,NaN,Infinity,'100']){
  const data=fixture();data.bars[50].volume=volume;
  const result=buildMobileIntelligence(data,{asOf:ending(data)});verifyNullLevels(result);assert.equal(result.volumeStatus,'invalid');
 }
});

test('gaps, malformed historical bars and invalid options do not masquerade as all-HOLD valid results',()=>{
 const cases=[
  [data=>{data.bars.splice(50,1);},'non-contiguous-history'],
  [data=>{data.bars[50].high=1;},'invalid-ohlc'],
  [data=>{data.bars[50].time='2025-01-01T12:30:00';},'timezone-required'],
  [data=>{data.bars[50].time='2025-02-30T12:30:00Z';},'invalid-time'],
  [data=>{data.bars[50].time=new Date(Date.parse(data.bars[50].time)+1).toISOString();},'unaligned-time'],
 ];
 for(const [mutate,reason] of cases){const data=fixture(),asOf=ending(data);mutate(data);const result=buildMobileIntelligence(data,{asOf});verifyNullLevels(result);assert.equal(result.reason,reason);}
 const short=fixture({length:119});verifyNullLevels(buildMobileIntelligence(short,{asOf:ending(short)}));
 verifyNullLevels(buildMobileIntelligence(null));verifyNullLevels(buildMobileIntelligence({...fixture(),timeframe:60}));
 const invalid=buildMobileIntelligence(fixture(),{asOf:NaN});verifyNullLevels(invalid);assert.equal(invalid.evaluatedAt,null);
});

test('mobile analysis is bounded to last720 closed bars and has no server-only dependencies',async()=>{
 const data=fixture({length:1000}),asOf=ending(data);
 assert.deepEqual(buildMobileIntelligence(data,{asOf}),buildMobileIntelligence({...data,bars:data.bars.slice(-720)},{asOf}));
 for(const file of ['mobile-intelligence.mjs','intelligence-ai.mjs','intelligence-strategies.mjs']){
  const source=await fs.readFile(new URL('../src/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\s+['"]node:/);assert.doesNotMatch(source,/\b(?:document|fetch|process|localStorage|Worker)\s*[.(]/);
  assert.doesNotMatch(source,/\bwindow\s*\.\s*(?:location|document|fetch|localStorage)/);
 }
});
