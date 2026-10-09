import test from 'node:test';
import assert from 'node:assert/strict';
import {SignalAlertTracker} from '../public/signal-alerts.js';

const NOW=Date.parse('2026-10-08T14:01:00.000Z');
const iso=ms=>new Date(ms).toISOString();
function fixture({id='signal-1',side='BUY',percent=82.4,at=NOW-1000}={}){
  const direction=side==='BUY'?'UP':'DOWN',event={id,type:'signal',mode:'observed-live',policy:'confidence-above-60-v1',symbol:'BTC/USD',source:'Kraken public · spot',strategy:'pullback',strategyName:'Retest EMA',side,confidencePercent:percent,confidenceClass:direction,signalTime:'2026-10-08T13:45:00.000Z',observedAt:iso(at),entry:100,stop:side==='BUY'?98:102,target:side==='BUY'?104:96};
  const remainder=1-percent/100,classProbs={UP:side==='BUY'?percent/100:remainder*.4,DOWN:side==='SELL'?percent/100:remainder*.4,FLAT:remainder*.6};
  return {signalPolicy:{id:'confidence-above-60-v1',minimumPercent:60,comparison:'>'},signalHistory:{mode:'observed-live',items:[event]},radar:[{symbol:event.symbol,source:event.source,live:true,feed:{status:'live'},quote:{price:100,receivedAt:iso(NOW-500),transport:'websocket'},decision:{strategy:event.strategy,strategyName:event.strategyName,side,closed:true,time:event.signalTime,entry:event.entry,stop:event.stop,target:event.target,confidence:{status:'estimate',class:direction,percent,classProbs}}}]};
}
const make=options=>new SignalAlertTracker({enabled:true,now:()=>NOW,...options});
function ready(options){const tracker=make(options);assert.deepEqual(tracker.consume({signalHistory:{items:[]},radar:[]},{streamFresh:true}),[]);return tracker;}

test('first observation establishes a silent baseline, then a new confirmed event alerts once',()=>{
  const tracker=make(),initial=fixture();
  assert.deepEqual(tracker.consume(initial,{streamFresh:true}),[]);
  const next=fixture({id:'signal-2'});
  assert.deepEqual(tracker.consume(next,{streamFresh:true}),[{id:'signal-2',symbol:'BTC/USD',side:'BUY',confidencePercent:82.4,strategyName:'Retest EMA',observedAt:iso(NOW-1000)}]);
  assert.deepEqual(tracker.consume(next,{streamFresh:true}),[]);
  assert.deepEqual(tracker.seenIds(),['signal-1','signal-2']);
});

test('both BUY and SELL alert, with confidence strictly greater than sixty',()=>{
  for(const side of ['BUY','SELL'])for(const percent of [60.1,100]){
    const state=fixture({side,percent}),tracker=ready();
    assert.equal(tracker.consume(state,{streamFresh:true}).length,1);
  }
});

test('disabled and disconnected observations are consumed silently and never replay after enabling or reconnection',()=>{
  const tracker=ready({enabled:false}),state=fixture();
  assert.deepEqual(tracker.consume(state,{streamFresh:true}),[]);
  tracker.setEnabled(true);assert.deepEqual(tracker.consume(state,{streamFresh:true}),[]);
  const second=fixture({id:'signal-2'});
  assert.deepEqual(tracker.consume(second,{streamFresh:false}),[]);
  assert.deepEqual(tracker.consume(second,{streamFresh:true}),[]);
  assert.equal(tracker.consume(fixture({id:'signal-3'}),{streamFresh:true}).length,1);
});

test('new tracker imports deduplication IDs so browser reload cannot replay recent events',()=>{
  const previous=ready();previous.consume(fixture(),{streamFresh:true});
  const tracker=ready({seenIds:previous.seenIds()});
  assert.deepEqual(tracker.consume(fixture(),{streamFresh:true}),[]);
  assert.equal(tracker.consume(fixture({id:'new-after-reload'}),{streamFresh:true}).length,1);
});

test('unconfirmed, stale, mismatched, malformed and historic events fail closed',()=>{
  const negatives=[
    ['seven percent',s=>{s.signalHistory.items[0].confidencePercent=7;}],
    ['exactly sixty percent',s=>{s.signalHistory.items[0].confidencePercent=60;}],
    ['above one hundred',s=>{s.signalHistory.items[0].confidencePercent=100.1;}],
    ['numeric string',s=>{s.signalHistory.items[0].confidencePercent='82.4';}],
    ['nonfinite confidence',s=>{s.signalHistory.items[0].confidencePercent=NaN;}],
    ['current low confidence',s=>{s.radar[0].decision.confidence.percent=60;}],
    ['current nonfinite confidence',s=>{s.radar[0].decision.confidence.percent=Infinity;}],
    ['current confidence unavailable',s=>{s.radar[0].decision.confidence.status='pending';}],
    ['current confidence class mismatch',s=>{s.radar[0].decision.confidence.class='DOWN';}],
    ['current probabilities missing',s=>{delete s.radar[0].decision.confidence.classProbs;}],
    ['current probabilities incoherent with percentage',s=>{s.radar[0].decision.confidence.classProbs={UP:.07,DOWN:.82,FLAT:.11};}],
    ['current probabilities not normalized',s=>{s.radar[0].decision.confidence.classProbs.FLAT=.3;}],
    ['current probability invalid',s=>{s.radar[0].decision.confidence.classProbs.DOWN=NaN;}],
    ['current probability negative',s=>{s.radar[0].decision.confidence.classProbs.DOWN=-.1;}],
    ['unpublished confidence precision',s=>{s.signalHistory.items[0].confidencePercent=60.01;}],
    ['observed confidence class mismatch',s=>{s.signalHistory.items[0].confidenceClass='DOWN';}],
    ['future observation',s=>{s.signalHistory.items[0].observedAt=iso(NOW+1);}],
    ['past observation',s=>{s.signalHistory.items[0].observedAt=iso(NOW-60001);}],
    ['missing observation date',s=>{delete s.signalHistory.items[0].observedAt;}],
    ['historical mode',s=>{s.signalHistory.items[0].mode='backtest';}],
    ['unknown event policy',s=>{s.signalHistory.items[0].policy='old-policy';}],
    ['unknown state policy',s=>{s.signalPolicy.id='other-policy';s.signalHistory.items[0].policy='other-policy';}],
    ['HOLD',s=>{s.signalHistory.items[0].side='HOLD';s.radar[0].decision.side='HOLD';}],
    ['forming decision',s=>{s.radar[0].decision.closed=false;}],
    ['provisional decision',s=>{s.radar[0].decision.provisional=true;}],
    ['unconfirmed setup',s=>{s.radar[0].decision.setup={confirmed:false};}],
    ['different source',s=>{s.radar[0].source='different feed';}],
    ['missing source',s=>{delete s.signalHistory.items[0].source;delete s.radar[0].source;}],
    ['different strategy',s=>{s.radar[0].decision.strategy='other-strategy';}],
    ['different side',s=>{s.radar[0].decision.side='SELL';}],
    ['different signal bar',s=>{s.radar[0].decision.time='2026-10-08T13:30:00.000Z';}],
    ['future signal bar',s=>{s.signalHistory.items[0].signalTime=iso(NOW+1);s.radar[0].decision.time=iso(NOW+1);}],
    ['no market',s=>{s.radar=[];}],
    ['not live',s=>{s.radar[0].live=false;}],
    ['feed snapshot',s=>{s.radar[0].feed.status='snapshot';}],
    ['stale WebSocket quote',s=>{s.radar[0].quote.receivedAt=iso(NOW-30000);}],
    ['future quote',s=>{s.radar[0].quote.receivedAt=iso(NOW+1);}],
    ['no quote',s=>{s.radar[0].quote=null;}],
    ['invalid quote price',s=>{s.radar[0].quote.price=0;}],
    ['invalid entry',s=>{s.signalHistory.items[0].entry=0;}],
    ['stop above BUY entry',s=>{s.signalHistory.items[0].stop=101;}],
    ['target below BUY entry',s=>{s.signalHistory.items[0].target=99;}],
    ['equal stop and entry',s=>{s.signalHistory.items[0].stop=100;}],
    ['negative target',s=>{s.signalHistory.items[0].target=-1;}],
    ['current levels invalid',s=>{s.radar[0].decision.stop=101;}],
    ['invalid identifier',s=>{s.signalHistory.items[0].id={};}],
  ];
  for(const [label,alter] of negatives){
    const tracker=ready(),state=fixture();alter(state);
    assert.deepEqual(tracker.consume(state,{streamFresh:true}),[],label);
  }
});

test('quote freshness follows transport and only recent, nonfuture event observations qualify',()=>{
  const recent=fixture({at:NOW-60000});recent.radar[0].quote.transport='rest';recent.radar[0].quote.receivedAt=iso(NOW-119999);
  assert.equal(ready().consume(recent,{streamFresh:true}).length,1);
  recent.radar[0].quote.receivedAt=iso(NOW-120000);
  assert.deepEqual(ready().consume(recent,{streamFresh:true}),[]);
  assert.deepEqual(ready().consume(fixture()),[],'stream freshness must be explicit');
});

test('clock injection and per-consume overrides make delayed consumption deterministic',()=>{
  const tracker=ready();
  assert.deepEqual(tracker.consume(fixture(),{streamFresh:true,now:NOW+61000}),[]);
  assert.equal(ready({now:()=>NOW+61000}).consume(fixture(),{streamFresh:true,now:NOW}).length,1);
});

test('imported IDs and new history are sanitized and bounded without mutating inputs',()=>{
  const ids=['',null,4,{},'x'.repeat(129),'bad\nline',' good ',...Array.from({length:510},(_,i)=>'import-'+i),'import-509'];
  const tracker=make({seenIds:ids}),before=structuredClone(ids);
  assert.equal(tracker.seenIds().length,500);assert.equal(new Set(tracker.seenIds()).size,500);
  assert.equal(tracker.seenIds()[0],'import-10');assert.deepEqual(ids,before);
  const copy=tracker.seenIds();copy.push('external');assert.ok(!tracker.seenIds().includes('external'));
  const state=fixture(),original=structuredClone(state);tracker.consume(state,{streamFresh:true});
  assert.equal(tracker.seenIds().length,500);assert.deepEqual(state,original);
  assert.doesNotThrow(()=>tracker.consume(null,{streamFresh:true}));
  assert.doesNotThrow(()=>tracker.consume({signalHistory:{items:[null,{},true]},radar:[null]},{streamFresh:true}));
});

test('multiple unseen live events emit in chronological order and repeated state is quiet',()=>{
  const first=fixture({id:'first',at:NOW-3000}),second=fixture({id:'second',side:'SELL',at:NOW-1000});
  second.signalHistory.items[0].symbol='XAU/USD';second.radar[0].symbol='XAU/USD';
  const state={...first,signalHistory:{mode:'observed-live',items:[second.signalHistory.items[0],first.signalHistory.items[0]]},radar:[first.radar[0],second.radar[0]]},tracker=ready();
  assert.deepEqual(tracker.consume(state,{streamFresh:true}).map(e=>e.id),['first','second']);
  assert.deepEqual(tracker.consume(state,{streamFresh:true}),[]);
});
