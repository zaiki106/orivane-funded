import test from 'node:test';
import assert from 'node:assert/strict';
import {researchCandidates,researchContext,researchSignal} from '../src/research-candidates.mjs';
import {indicators} from '../src/engine.mjs';
const bar=(open,close)=>({open,close,high:Math.max(open,close)+.1,low:Math.min(open,close)-.1});
const contexts={
 'rsi2-trend-recovery':{x:bar(100,101),p:bar(101,100),atr:1,e200:99,previousRsi2:8,rsi2:20},
 'ema200-engulfing':{x:bar(98.5,101),p:bar(100.5,99),atr:1,e200:99,previousE200:98},
 'atr-expansion-channel':{x:bar(98,102),p:bar(99,100),atr:1,high20:101,low20:97,e50:99},
 'utc-asian-range':{x:bar(100,101),p:bar(99,100),atr:1,sessionReady:true,sessionHour:8,dayHigh:100.5,dayLow:98},
 'daily-vwap-reentry':{x:bar(97.5,98.6),p:bar(98,97),atr:1,previousAtr:1,vwap:100,previousVwap:100},
 'regression40-reentry':{x:bar(100,101),p:bar(101,100),atr:1,z:-1,previousZ:-2.5,slopeAtr:.05}
};
function mirror(c){const result={...c,x:bar(200-c.x.open,200-c.x.close),p:bar(200-c.p.open,200-c.p.close)};
 for(const key of ['e200','previousE200','e50','vwap','previousVwap'])if(c[key]!=null)result[key]=200-c[key];
 for(const key of ['rsi2','previousRsi2'])if(c[key]!=null)result[key]=100-c[key];
 for(const key of ['z','previousZ','slopeAtr'])if(c[key]!=null)result[key]=-c[key];
 if(c.high20!=null){result.high20=200-c.low20;result.low20=200-c.high20;}
 if(c.dayHigh!=null){result.dayHigh=200-c.dayLow;result.dayLow=200-c.dayHigh;}
 return result;
}
for(const rule of researchCandidates)test(rule.id+' detects both defined directions with immutable ordered levels',()=>{
 const c=contexts[rule.id],buy=researchSignal(c,rule.id),sell=researchSignal(mirror(c),rule.id);
 assert.equal(buy.side,'BUY');assert.equal(sell.side,'SELL');
 for(const r of [buy,sell]){const d=r.side==='BUY'?1:-1;assert.ok(d*(r.entry-r.stop)>0);assert.ok(d*(r.target-r.entry)>0);assert.ok(Math.abs(d*(r.target-r.entry)/(1.4*c.atr)-rule.parameters.targetR)<1e-10);assert.equal(r.researchOnly,true);assert.equal(r.confidence,undefined);}
 assert.equal(researchSignal(null,rule.id).side,'HOLD');
});
test('research context EMA and RSI match the analytic linear series; forming bars and gaps are excluded',()=>{
 const t=Date.UTC(2026,0,1),bars=Array.from({length:240},(_,i)=>({...bar(100+i*.1-.05,100+i*.1),time:new Date(t+i*900000).toISOString(),volume:10,closed:true}));
 const q=indicators(bars.slice(-160)),context=researchContext(bars,q);
 assert.ok(Math.abs(context.e200-(bars.at(-1).close-9.95))<1e-10);assert.equal(context.rsi2,100);
 assert.deepEqual(researchContext([...bars,{...bars.at(-1),time:new Date(t+240*900000).toISOString(),close:999,closed:false}],q),context);
 const gapped=structuredClone(bars);gapped[120].time=new Date(t+119*900000).toISOString();assert.equal(researchContext(gapped,q),null);
 assert.equal(researchContext(bars.slice(-219),q),null);
});
test('VWAP and UTC session requirements fail closed rather than fabricate volume or session',()=>{
 assert.equal(researchSignal({...contexts['daily-vwap-reentry'],vwap:null},'daily-vwap-reentry').side,'HOLD');
 assert.equal(researchSignal({...contexts['utc-asian-range'],sessionReady:false},'utc-asian-range').side,'HOLD');
 assert.equal(researchSignal({...contexts['utc-asian-range'],sessionHour:10},'utc-asian-range').side,'HOLD');
});
