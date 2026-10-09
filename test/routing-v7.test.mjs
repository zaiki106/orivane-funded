import test from 'node:test';
import assert from 'node:assert/strict';
import {signal} from '../src/engine.mjs';
import {routeStrategy,decide,classes,featureNames,featureWindow,decisionVersion} from '../src/decision.mjs';
import {routeFixtures,strategyFixtures,reflected} from './helpers/strategy-v7-fixtures.mjs';
const model=side=>({version:decisionVersion,classes:[...classes],featureWindow,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:(side==='BUY'?[.8,.1,.1]:[.1,.8,.1]).map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}});

// The two recovery examples use less than 21 complete hours. Their longer
// histories below separately verify that an opposing H1 blocks publication.
const publicationFixtures={...routeFixtures,'fisher-recovery':routeFixtures['fisher-recovery'].slice(-80),'williams-recovery':strategyFixtures['williams-recovery']};
for(const [id,bars] of Object.entries(publicationFixtures))test(id+' participates in the actual router with confidence and completed-candle gates',()=>{
  for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    assert.equal(signal(input,id).side,side,'Raw rule must establish this structure before the router chooses it');
    assert.equal(routeStrategy(input).strategy,id,'The rule must be reachable, not merely a catalogue item');
    const result=decide(input,model(side));
    assert.equal(result.side,side);assert.equal(result.confidence.percent,80);
    const dir=side==='BUY'?1:-1;
    assert.ok(dir*(result.entry-result.stop)>0&&dir*(result.target-result.entry)>0);
    const rejected=decide(input,{...model(side),weights:[.2,.2,.6].map(p=>[Math.log(p),...Array(featureNames.length).fill(0)])});
    assert.equal(rejected.side,'HOLD');assert.equal(rejected.filteredByConfidence,true);assert.deepEqual([rejected.entry,rejected.stop,rejected.target],[null,null,null]);
    const forming={...input.at(-1),time:new Date(Date.parse(input.at(-1).time)+900000).toISOString(),closed:false,high:500,low:1,close:400};
    assert.deepEqual(decide([...input,forming],model(side)),result);
  }
});

test('recovery candidates remain blocked when a genuine completed H1 trend is opposite',()=>{
  for(const id of ['fisher-recovery','williams-recovery'])for(const [input,side] of [[routeFixtures[id],'BUY'],[reflected(routeFixtures[id]),'SELL']]){
    assert.equal(routeStrategy(input).strategy,id);assert.equal(signal(input,id).side,side);
    const d=decide(input,model(side));assert.equal(d.route.higherTimeframe.available,true);assert.equal(d.confidenceGate.candidatePercent,80);
    assert.equal(d.side,'HOLD');assert.equal(d.filteredByH1,true);assert.deepEqual([d.entry,d.stop,d.target],[null,null,null]);
  }
});
