import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePriceResearch,priceResearchStrategies} from '../src/price-research.mjs';
import {buildMobileIntelligence} from '../src/mobile-intelligence.mjs';
const interval=900000,start=Date.UTC(2025,0,1);
const fixture=(trend=0)=>Array.from({length:160},(_,i)=>{const c=100+i*trend;return {time:new Date(start+i*interval).toISOString(),open:c,high:c+1,low:c-1,close:c,volume:0,volumeUnavailable:true,closed:true};});
const bar=(open,high,low,close)=>({open,high,low,close});
const finish=bars=>Date.parse(bars.at(-1).time)+interval;
const set=(bars,index,value)=>Object.assign(bars[index],value);
function buyFixture(id){
 const bars=fixture(['price-rsi2','price-heikin-turn'].includes(id)?.5:0);
 if(id==='price-rsi2'){set(bars,157,bar(178,179,173,174));set(bars,158,bar(174,175,169,170));set(bars,159,bar(170,175,169,174));}
 if(id==='price-heikin-turn'){for(let i=156;i<159;i++)set(bars,i,bar(178,178.5,173,174));set(bars,159,bar(174,182,173,181));}
 if(id==='price-pivot-reclaim')set(bars,159,bar(98.8,100.5,98,100));
 if(id==='price-dual-thrust')set(bars,159,bar(100,102,99.8,101.5));
 if(id==='price-range-drive'){set(bars,157,bar(100,102,99.2,101));set(bars,158,bar(101,103,100,102));set(bars,159,bar(102,106,100.5,105));}
 if(id==='price-three-bar-turn'){set(bars,157,bar(102,102.2,99.8,100));set(bars,158,bar(100,100.2,99.7,99.9));set(bars,159,bar(100,102,99.8,101.5));}
 if(id==='price-rank-recovery'){set(bars,158,bar(100,100.2,98.8,99));set(bars,159,bar(99,101.5,98.9,101));}
 if(id==='price-nine-exhaustion'){for(let i=146;i<159;i++){const c=110-(i-146);set(bars,i,bar(c+.3,c+.5,c-.5,c));}set(bars,159,bar(98,101,97.5,100));}
 if(id==='price-mad-reentry'){for(let j=0;j<158;j++){const c=99+j%3;set(bars,j,bar(c,c+1,c-1,c));}set(bars,158,bar(99,100,94,95));set(bars,159,bar(95,101,94.5,100));}
 if(['price-bop-cross','price-rvi-cross','price-dmi-cross'].includes(id))set(bars,159,bar(100,103,99.5,102));
 if(id==='price-gap-fill')set(bars,159,bar(98,101,97,100.5));
 if(id==='price-fvg-retest'){set(bars,155,bar(100,101,99,100));set(bars,156,bar(100,104,99.8,103.5));set(bars,157,bar(103,104,102.5,103.5));set(bars,158,bar(103.5,104.5,103,104));set(bars,159,bar(102.4,104.5,102.3,104));}
 if(id==='price-hikkake'){set(bars,156,bar(100,102,98,100));set(bars,157,bar(100,101,99,100));set(bars,158,bar(100,100.5,98.5,98.8));set(bars,159,bar(99,102,99,101.5));}
 if(id==='price-rsi-divergence'){set(bars,145,bar(100,101,90,91));set(bars,157,bar(100,101,89,98));set(bars,159,bar(100,103,99.5,102));}
 return bars;
}
const mirrored=bars=>bars.map(b=>({...b,open:300-b.open,high:300-b.low,low:300-b.high,close:300-b.close}));
for(const rule of priceResearchStrategies){
 test(rule.id+' detects hand-constructed BUY and mirrored SELL without volume',()=>{
  for(const [bars,side] of [[buyFixture(rule.id),'BUY'],[mirrored(buyFixture(rule.id)),'SELL']]){
   const actual=evaluatePriceResearch(bars,{asOf:finish(bars)}).find(r=>r.id===rule.id);
   assert.equal(actual.side,side,JSON.stringify(actual.directionalChecks));assert.equal(actual.dataReady,true);
   assert.equal(actual.entry,bars.at(-1).close);assert.ok(actual.stop>0&&actual.target>0);
   assert.equal(actual.researchOnly,true);assert.equal(actual.volumeRequired,false);
   assert.ok(Math.abs(Math.abs(actual.target-actual.entry)/Math.abs(actual.entry-actual.stop)-2)<1e-10);
   assert.equal(Object.hasOwn(actual,'confidence'),false);
  }
 });
}
test('price-only recipes remain available when volume-dependent diagnostics are blocked',()=>{
 const bars=buyFixture('price-dual-thrust');const result=buildMobileIntelligence({timeframe:15,bars},{asOf:finish(bars)});
 assert.equal(result.reason,'real-volume-required');assert.equal(result.priceStrategies.length,16);
 assert.equal(result.priceStrategies.find(r=>r.id==='price-dual-thrust').side,'BUY');
 assert.ok(result.strategies.every(r=>r.side==='HOLD'));
});
test('price recipes reject gaps, future/forming influence, short history and invalid prices',()=>{
 const bars=buyFixture('price-dual-thrust'),asOf=finish(bars),baseline=evaluatePriceResearch(bars,{asOf});
 for(const appended of [{...bars.at(-1),time:new Date(asOf).toISOString(),close:100000,high:100001},{closed:false,time:'invalid'}])assert.deepEqual(evaluatePriceResearch([...bars,appended],{asOf}),baseline);
 for(const broken of [bars.slice(-119),bars.filter((_,i)=>i!==80),bars.map((b,i)=>i===80?{...b,close:Infinity}:b)]){
  const result=evaluatePriceResearch(broken,{asOf});assert.ok(result.every(r=>r.dataReady===false&&r.side==='HOLD'&&r.entry===null));
 }
 assert.deepEqual(bars,buyFixture('price-dual-thrust'));
});
test('flat price gives no artificial active signal and carries explicit criteria',()=>{
 const bars=fixture(),result=evaluatePriceResearch(bars,{asOf:finish(bars)});
 assert.equal(new Set(result.map(r=>r.id)).size,16);assert.ok(result.every(r=>r.side==='HOLD'&&r.directionalChecks.BUY.some(c=>!c.passed)&&r.directionalChecks.SELL.some(c=>!c.passed)));
});
