import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIdeaSetups,rankIdeas,explainHold} from '../src/ideas.mjs';
import {signal,indicators,strategies} from '../src/engine.mjs';

const now=Date.UTC(2026,9,8,12),interval=900000;
function dataset(){return {symbol:'EUR/USD',source:'Provider fixture',timeframe:15,bars:Array.from({length:100},(_,i)=>({time:new Date(now-(100-i)*interval).toISOString(),open:100,high:101,low:99,close:100,volume:0}))};}

test('ideas use completed provider candles and ignore forming or future observations',()=>{
  const d=dataset(),setups=buildIdeaSetups(d,{now});
  const forming={time:new Date(now).toISOString(),open:100,high:500,low:50,close:400,volume:500,closed:false};
  assert.deepEqual(buildIdeaSetups({...d,bars:[...d.bars,forming]},{now}),setups);
  assert.deepEqual(buildIdeaSetups({...d,bars:[...d.bars,{...forming,closed:true}]},{now}),setups);
  assert.equal(setups.length,strategies.length*2);
  for(const setup of setups){assert.equal(setup.source,d.source);assert.equal(setup.asOf,d.bars.at(-1).time);assert.equal(setup.requiresClose,true);assert.ok(!('score'in setup)&&!('confidence'in setup)&&!('probability'in setup));}
});

test('cached signals share the same closed-candle setup calculation',()=>{
  const d=dataset(),context=indicators(d.bars),signals=['breakout','macd'].map(id=>signal(d.bars,id,context));
  const actual=buildIdeaSetups(d,{now,signals,context});
  assert.deepEqual(actual,buildIdeaSetups(d,{now}).filter(setup=>['breakout','macd'].includes(setup.strategy)));
  const range=actual.find(setup=>setup.strategy==='breakout'&&setup.side==='BUY');
  assert.equal(range.trigger,101);assert.equal(range.riskProvisional,true);assert.match(range.riskBasis,/confirmation/);assert.equal(range.stop,null);assert.equal(range.target,null);
});

test('conditional ideas publish no speculative stops or targets and separate the next confirmation time',()=>{
  for(const setup of buildIdeaSetups(dataset(),{now})){
    assert.equal(setup.stop,null);assert.equal(setup.target,null);
    assert.equal(setup.referenceClosedAt,new Date(now).toISOString());assert.equal(setup.confirmationAt,new Date(now+interval).toISOString());
    assert.equal(setup.lastClosedChecksAt,dataset().bars.at(-1).time);
  }
});

test('ideas respect their own H1 direction and never inherit an opposite candidate block',()=>{
  const base=buildIdeaSetups(dataset(),{now}).find(setup=>setup.strategy==='breakout'&&setup.side==='SELL'),
    decision={side:'HOLD',strategy:'macd',filteredByH1:true,reason:'Filtre H1 opposé au signal BUY',route:{higherTimeframe:{available:true,direction:'DOWN'}}};
  const ideas=rankIdeas([{...base,side:'BUY',trigger:100},{...base,side:'SELL',trigger:99}],{quote:{price:100,receivedAt:new Date(now).toISOString()},isFresh:true,live:true,decision,now});
  assert.equal(ideas.length,1);assert.equal(ideas[0].side,'SELL');assert.ok(!ideas[0].blockingReasons.some(reason=>reason.includes('opposé au signal BUY')));
});

test('the actual confirmed strategy stays first and stale or invalid plans are never confirmed',()=>{
  const base=buildIdeaSetups(dataset(),{now}).find(setup=>setup.strategy==='breakout'&&setup.side==='BUY'),
    options={quote:{price:100,receivedAt:new Date(now).toISOString()},isFresh:true,live:true,now,decision:{strategy:'breakout',side:'BUY',entry:105,stop:95,target:115}};
  const ideas=rankIdeas([{...base,trigger:105},{...base,strategy:'near',trigger:100}],options);
  assert.equal(ideas[0].strategy,'breakout');assert.equal(ideas[0].confirmed,true);assert.equal(ideas[0].confirmationAt,new Date(now).toISOString());
  assert.deepEqual(rankIdeas([base],{...options,isFresh:false}),[]);
  const invalid=rankIdeas([base],{...options,decision:{...options.decision,stop:110}});assert.ok(!invalid.some(idea=>idea.confirmed));
});

test('setup indicators use the same final 160-candle window as the decision router',()=>{
  const d=dataset(),older=Array.from({length:200},(_,i)=>({time:new Date(now-(300-i)*interval).toISOString(),open:500,high:501,low:499,close:500,volume:0})),long={...d,bars:[...older,...d.bars]};
  assert.deepEqual(buildIdeaSetups(long,{now}),buildIdeaSetups({...long,bars:long.bars.slice(-160)},{now}));
});

test('dynamic boundaries and future structural stops stay explicitly unknown',()=>{
  const setups=buildIdeaSetups(dataset(),{now});
  for(const id of ['stochastic','vwap','continuation','keltner-reentry'])for(const idea of setups.filter(setup=>setup.strategy===id)){assert.equal(idea.trigger,null);assert.equal(idea.stop,null);assert.equal(idea.target,null);assert.ok(idea.condition.length>10);}
  for(const idea of setups.filter(setup=>setup.riskModel==='structure')){assert.equal(idea.stop,null);assert.equal(idea.target,null);assert.match(idea.riskBasis,/uniquement après confirmation/);}
});

test('three ideas rank only by current distance to measurable trigger with one per strategy',()=>{
  const all=buildIdeaSetups(dataset(),{now}),base=all.find(setup=>setup.strategy==='breakout'&&setup.side==='BUY');
  const setups=[{...base,id:'far',strategy:'far',trigger:120,atr:2,blockingReasons:[]},
    {...base,id:'closest',strategy:'closest',trigger:101,atr:2,blockingReasons:['Condition encore absente']},
    {...base,id:'near',strategy:'near',trigger:104,atr:2},
    {...base,id:'duplicate',strategy:'closest',side:'SELL',trigger:110,atr:2},
    {...base,id:'unknown',strategy:'unknown',trigger:null,atr:2}];
  const ideas=rankIdeas(setups,{quote:{price:100,receivedAt:new Date(now).toISOString()},isFresh:true,live:true,now});
  assert.deepEqual(ideas.map(idea=>idea.id),['closest','near','far']);assert.deepEqual(ideas.map(idea=>idea.distanceToTriggerATR),[.5,2,10]);
  assert.ok(ideas.every(idea=>idea.status==='conditional'&&!idea.confirmed&&idea.live));assert.ok(ideas[0].blockingReasons.includes('Condition encore absente'));
});

test('only the routed confirmed closed-bar strategy gets its real trade plan',()=>{
  const base=buildIdeaSetups(dataset(),{now}).find(setup=>setup.strategy==='breakout'&&setup.side==='BUY'),
    setup={...base,evaluatedSide:'BUY',confirmedPlan:{entry:102,stop:98,target:109}};
  const options={quote:{price:102,receivedAt:new Date(now-1000).toISOString()},isFresh:true,live:true,now,decision:{strategy:'breakout',side:'BUY',entry:103,stop:97,target:111}};
  const confirmed=rankIdeas([setup],options)[0];assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.confirmed,true);assert.equal(confirmed.riskProvisional,false);assert.equal(confirmed.entryTrigger,103);assert.equal(confirmed.stop,97);assert.equal(confirmed.target,111);assert.equal(confirmed.quoteAgeMs,1000);
  const alternative=rankIdeas([setup],{...options,decision:{strategy:'macd',side:'BUY'}})[0];assert.equal(alternative.status,'conditional');assert.equal(alternative.confirmed,false);assert.ok(alternative.blockingReasons.includes('Dernière clôture : autre règle retenue par le routeur'));
  assert.deepEqual(rankIdeas([setup],{...options,isFresh:false}),[]);
});

test('impossible next-candle prerequisites cannot win a tied nearest-trigger ranking',()=>{
  const base=buildIdeaSetups(dataset(),{now}).find(setup=>setup.strategy==='breakout'&&setup.side==='BUY');
  const ideas=rankIdeas([{...base,strategy:'ema-cross',side:'BUY',trigger:100,prerequisites:[{label:'EMA 9 ≤ EMA 21 avant le nouveau croisement',met:false}]},
    {...base,strategy:'ema-cross',side:'SELL',trigger:100,prerequisites:[{label:'EMA 9 ≥ EMA 21 avant le nouveau croisement',met:true}]}],
    {quote:{price:100,receivedAt:new Date(now).toISOString()},isFresh:true,now});
  assert.equal(ideas.length,1);assert.equal(ideas[0].side,'SELL');
});

test('a current quote cannot claim a completed wick sweep or future indicator condition',()=>{
  const base=buildIdeaSetups(dataset(),{now}).find(setup=>setup.strategy==='breakout'&&setup.side==='BUY'),options={quote:{price:105,receivedAt:new Date(now).toISOString()},isFresh:true,now};
  assert.equal(rankIdeas([{...base,trigger:100,triggerMode:'sweep_reclaim'}],options)[0].triggerCrossed,null);
  assert.equal(rankIdeas([{...base,trigger:100,triggerMode:'indicator'}],options)[0].triggerCrossed,null);
  assert.equal(rankIdeas([{...base,trigger:100,triggerMode:'close_above'}],options)[0].triggerCrossed,true);
  assert.equal(rankIdeas([{...base,trigger:110,triggerMode:'close_below'}],options)[0].triggerCrossed,true);
});

test('HOLD explanation exposes candle closing times and actual missing criteria',()=>{
  const d=dataset(),decision={side:'HOLD',reason:'Filtre H1 opposé au signal BUY',filteredByH1:true,checks:[{label:'Volume',passed:false},{label:'Clôture',passed:true}],dataMode:'live'};
  const reason=explainHold(d,decision,{isFresh:true,now:now+2000});assert.equal(reason.lastClosedBarAt,d.bars.at(-1).time);assert.equal(reason.lastClosedAt,new Date(now).toISOString());assert.equal(reason.nextCloseAt,new Date(now+interval).toISOString());assert.deepEqual(reason.blocks,[decision.reason,'Volume']);assert.equal(reason.requiresClose,true);
  assert.equal(explainHold(d,decision,{isFresh:false,now}).nextCloseAt,null);
});
