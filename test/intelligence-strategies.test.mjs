import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeIntelligenceContext,intelligenceSignal,signalFromIntelligenceContext,intelligenceStrategies,intelligenceStrategiesVersion} from '../src/intelligence-strategies.mjs';

const start=Date.parse('2024-01-01T00:00:00Z'),step=900_000,nowMs=start+120*step;
const options={nowMs};
function history(price=()=>100) {return Array.from({length:120},(_,i)=>{const close=price(i);return {time:new Date(start+i*step).toISOString(),open:close,high:close+1,low:close-1,close,volume:100,closed:true};});}
function invert(bars) {return bars.map(bar=>({...bar,open:300-bar.open,high:300-bar.low,low:300-bar.high,close:300-bar.close}));}
function fixture(id) {
  const bars=history();
  if(id==='intel-donchian55')Object.assign(bars[119],{open:100,high:105,low:99.9,close:104});
  if(id==='intel-keltner20'){
    const trend=history(i=>100+i*.2);trend.forEach(bar=>{bar.high=bar.close+.6;bar.low=bar.close-.6;});
    Object.assign(trend[118],{open:123.4,high:124,low:119.5,close:121});Object.assign(trend[119],{open:121,high:125,low:120.8,close:124.8});return trend;
  }
  if(id==='intel-bollinger-release'){
    const squeeze=history(i=>100+Math.sin(i)*(i<90?3:.02));Object.assign(squeeze[119],{open:100,high:103,low:99.9,close:102.5,volume:200});return squeeze;
  }
  if(id==='intel-failed20'){
    Object.assign(bars[118],{open:100,high:100.1,low:97,close:97.5});Object.assign(bars[119],{open:97.5,high:101,low:97.4,close:100.5});
  }
  if(id==='intel-inside-contraction'){
    Object.assign(bars[118],{open:100,high:100.3,low:99.7,close:100.1});Object.assign(bars[119],{open:100.1,high:102,low:99.9,close:101.5});
  }
  if(id==='intel-efficiency-momentum'){
    const trend=history(i=>100+i*.1);Object.assign(trend[119],{open:111.8,high:116,low:111.5,close:115.5});return trend;
  }
  return bars;
}
function near(actual,expected) {assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);}

test('six isolated versioned research recipes with frozen metadata and fixed risk parameters',()=>{
  assert.equal(intelligenceStrategies.length,6);assert.equal(new Set(intelligenceStrategies.map(rule=>rule.id)).size,6);
  assert.equal(intelligenceStrategiesVersion,'orivane-intelligence-strategies-v1');assert.ok(Object.isFrozen(intelligenceStrategies));
  for(const rule of intelligenceStrategies){assert.ok(Object.isFrozen(rule));assert.ok(Object.isFrozen(rule.parameters));assert.equal(rule.warmupBars,120);assert.equal(rule.parameters.stopAtr,1.5);assert.ok([1.5,2].includes(rule.parameters.targetR));assert.equal(rule.confidence,null);assert.equal(rule.researchOnly,true);assert.ok(rule.formula&&rule.prerequisites.length);}
});
for(const rule of intelligenceStrategies)for(const side of ['BUY','SELL'])test(`${rule.id}: independently constructed ${side} setup and fixed risk levels`,()=>{
  const bars=side==='BUY'?fixture(rule.id):invert(fixture(rule.id));const before=structuredClone(bars);const context=analyzeIntelligenceContext(bars,options);
  assert.equal(context.valid,true,context.reason);const signal=intelligenceSignal(bars,rule.id,options);assert.equal(signal.side,side,JSON.stringify(signal));
  assert.deepEqual(signalFromIntelligenceContext(context,rule.id),signal);assert.equal(signal.strategy,rule.id);assert.equal(signal.entry,bars.at(-1).close);
  const direction=side==='BUY'?1:-1;near(signal.stop,signal.entry-direction*1.5*signal.atr);near(signal.target,signal.entry+direction*1.5*signal.atr*rule.parameters.targetR);
  assert.equal(signal.researchOnly,true);assert.equal(signal.confidence,null);assert.ok(Object.isFrozen(signal));assert.deepEqual(bars,before);
});
test('analytic flat and one-jump indicator values',()=>{
  const bars=history(),flat=analyzeIntelligenceContext(bars,options);assert.equal(flat.valid,true);near(flat.atr,2);near(flat.ema20,100);near(flat.ema55,100);near(flat.er20,0);near(flat.roc8Atr,0);near(flat.bandwidth,0);
  Object.assign(bars[119],{open:102,high:104,low:102,close:103});const context=analyzeIntelligenceContext(bars,options);near(context.atr,30/14);near(context.ema20,100+6/21);near(context.ema55,100+6/56);near(context.er20,1);near(context.roc8Atr,1.4);
  const center=100.15,variance=(19*.15**2+2.85**2)/20;near(context.bandwidth,4*Math.sqrt(variance)/center);
});
test('warmup, gaps, ordering, timezone, alignment, invalid OHLC and real volume fail closed',()=>{
  const cases=[
    [bars=>bars.slice(1),'insufficient-history'],
    [bars=>{bars[50].time=new Date(start+51*step).toISOString();return bars;},'non-contiguous-history'],
    [bars=>{[bars[50],bars[51]]=[bars[51],bars[50]];return bars;},'non-contiguous-history'],
    [bars=>{bars[50].time='2024-01-01T12:30:00';return bars;},'timezone-required'],
    [bars=>{bars[50].time=new Date(start+50*step+1).toISOString();return bars;},'unaligned-time'],
    [bars=>{bars[50].high=99;return bars;},'invalid-ohlc'],
    [bars=>{bars[50].close=Infinity;return bars;},'invalid-ohlc'],
    [bars=>{bars[50].volume=0;return bars;},'real-volume-required'],
    [bars=>{delete bars[50].volume;return bars;},'real-volume-required'],
    [bars=>{bars[50].volumeUnavailable=true;return bars;},'real-volume-required'],
    [bars=>{bars[50].syntheticVolume=true;return bars;},'real-volume-required'],
  ];
  for(const [mutate,reason]of cases){const bars=mutate(history());assert.equal(analyzeIntelligenceContext(bars,options).reason,reason);for(const rule of intelligenceStrategies){const signal=intelligenceSignal(bars,rule.id,options);assert.equal(signal.side,'HOLD');assert.equal(signal.reason,reason);assert.equal(signal.entry,null);assert.equal(signal.stop,null);assert.equal(signal.target,null);assert.equal(signal.confidence,null);}}
});
test('constant history invents no setup for any strategy',()=>{for(const rule of intelligenceStrategies)assert.equal(intelligenceSignal(history(),rule.id,options).side,'HOLD');});
test('volume confirmation cannot be substituted in squeeze release',()=>{
  const bars=fixture('intel-bollinger-release');bars.at(-1).volume=100;assert.equal(intelligenceSignal(bars,'intel-bollinger-release',options).side,'HOLD');
  bars.at(-1).volume=200;bars[105].volumeUnavailable=true;assert.equal(intelligenceSignal(bars,'intel-bollinger-release',options).side,'HOLD');
});
test('squeeze threshold uses 60 training bandwidths excluding prior setup and current bar',()=>{
  const bars=fixture('intel-bollinger-release'),first=analyzeIntelligenceContext(bars,options);const threshold=first.squeezeThreshold;
  Object.assign(bars[118],{open:100,high:130,low:70,close:125});Object.assign(bars[119],{open:125,high:150,low:90,close:140});const changed=analyzeIntelligenceContext(bars,options);assert.equal(changed.squeezeThreshold,threshold);assert.equal(intelligenceSignal(bars,'intel-bollinger-release',options).side,'HOLD');
});
test('first-cross momentum does not repeatedly signal persistent above-threshold momentum',()=>{
  const bars=history(i=>100+i*.7);assert.ok(analyzeIntelligenceContext(bars,options).roc8Atr>1.5);assert.equal(intelligenceSignal(bars,'intel-efficiency-momentum',options).side,'HOLD');
});
test('forming and future appendages do not change any completed-bar decision',()=>{
  for(const rule of intelligenceStrategies){const bars=fixture(rule.id),expected=intelligenceSignal(bars,rule.id,options);const next={...bars.at(-1),time:new Date(nowMs).toISOString(),open:1,high:1000,low:.1,close:900,volume:1e9};
    assert.deepEqual(intelligenceSignal([...bars,{...next,closed:false}],rule.id,options),expected);
    assert.deepEqual(intelligenceSignal([...bars,next],rule.id,options),expected);
    assert.deepEqual(intelligenceSignal([...bars,{...next,time:new Date(nowMs+step*10).toISOString()}],rule.id,options),expected);
  }
});
test('context is bounded at last 240 bars and accepts equivalent explicit timezone offsets',()=>{
  const bars=Array.from({length:300},(_,i)=>({...history()[0],time:new Date(start+i*step).toISOString()}));const context=analyzeIntelligenceContext(bars,{nowMs:start+300*step});assert.equal(context.bars.length,240);assert.equal(context.bars[0].time,bars[60].time);
  const offset=history();offset[0].time='2024-01-01T01:00:00+01:00';assert.equal(analyzeIntelligenceContext(offset,options).valid,true);
});
test('unknown strategy ids are rejected explicitly',()=>assert.throws(()=>intelligenceSignal(history(),'missing',options),RangeError));
