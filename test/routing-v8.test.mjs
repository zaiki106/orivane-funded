import test from 'node:test';
import assert from 'node:assert/strict';
import {signal} from '../src/engine.mjs';
import {routeStrategy,decide,classes,featureNames,featureWindow,decisionVersion} from '../src/decision.mjs';
import {routeFixtures,reflected} from './helpers/strategy-v8-fixtures.mjs';
const model=side=>({version:decisionVersion,classes:[...classes],featureWindow,status:'estimate',calibratedThrough:'2025-01-01T00:00:00Z',temperature:1,weights:(side==='BUY'?[.8,.1,.1]:[.1,.8,.1]).map(p=>[Math.log(p),...Array(featureNames.length).fill(0)]),scaler:{mean:Array(featureNames.length).fill(0),scale:Array(featureNames.length).fill(1)}});

for(const [id,bars] of Object.entries(routeFixtures))test(id+' is operational in the ordered router with real BUY/SELL structure and publication guards',()=>{
  for(const [input,side] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    assert.equal(signal(input,id).side,side);
    const route=routeStrategy(input);assert.equal(route.strategy,id);
    const result=decide(input,model(side)),opposed=route.higherTimeframe.available&&route.higherTimeframe.direction===(side==='BUY'?'DOWN':'UP');
    assert.equal(result.side,opposed?'HOLD':side);assert.equal(result.confidenceGate.candidatePercent,80);
    if(opposed){
      assert.equal(result.filteredByH1,true);assert.deepEqual([result.entry,result.stop,result.target],[null,null,null]);
      // The shorter closed prefix retains the same raw event while explicitly
      // exercising the documented fallback with fewer than 21 complete hours.
      const short=input.slice(-80),published=decide(short,model(side));
      assert.equal(signal(short,id).side,side);assert.equal(routeStrategy(short).strategy,id);
      assert.equal(published.route.higherTimeframe.available,false);assert.equal(published.side,side);assert.equal(published.confidence.percent,80);
      const dir=side==='BUY'?1:-1;assert.ok(dir*(published.entry-published.stop)>0&&dir*(published.target-published.entry)>0);
    }
    else{const dir=side==='BUY'?1:-1;assert.ok(dir*(result.entry-result.stop)>0&&dir*(result.target-result.entry)>0);}
    const rejected=decide(input,{...model(side),weights:[.2,.2,.6].map(p=>[Math.log(p),...Array(featureNames.length).fill(0)])});
    assert.equal(rejected.side,'HOLD');assert.deepEqual([rejected.entry,rejected.stop,rejected.target],[null,null,null]);
    const forming={...input.at(-1),time:new Date(Date.parse(input.at(-1).time)+900000).toISOString(),closed:false,high:500,low:1,close:400};
    assert.deepEqual(decide([...input,forming],model(side)),result);
  }
});
