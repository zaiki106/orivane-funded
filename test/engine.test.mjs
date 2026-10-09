import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {exitPrice,metrics,sizePosition,validateBars,backtest,laboratory,strategies,signal,indicators,setupTriggers} from '../src/engine.mjs';
test('ambiguous candle chooses stop before target for both directions',()=>{assert.deepEqual(exitPrice({side:'BUY',stop:95,target:110},{open:100,low:94,high:111}),{price:95,reason:'Stop'});assert.deepEqual(exitPrice({side:'SELL',stop:105,target:90},{open:100,low:89,high:106}),{price:105,reason:'Stop'});});
test('gap fills at adverse open instead of ideal stop',()=>{assert.deepEqual(exitPrice({side:'BUY',stop:95,target:110},{open:90,low:88,high:100}),{price:90,reason:'Gap stop'});});
test('position includes costs and caps unlevered notional',()=>{const s=sizePosition({capital:100000,riskPercent:.25,entry:100,stop:99,feeBps:10,slippageBps:5});assert.equal(s.risk,250);assert.ok(Math.abs(s.quantity-250/1.3)<1e-8);assert.ok(s.notional<=100000);assert.throws(()=>sizePosition({capital:100,riskPercent:2,entry:100,stop:99}));});
test('win rate denominator, net expectancy and drawdown use all closed trades',()=>{const m=metrics([{r:2},{r:-1},{r:0},{r:-1}]);assert.equal(m.n,4);assert.equal(m.winRate,25);assert.equal(m.expectancy,0);assert.equal(m.profitFactor,1);assert.equal(m.maxDrawdownR,2);assert.ok(m.winInterval[0]<25&&m.winInterval[1]>25);assert.equal(metrics([]).winRate,null);});
test('rejects future, duplicate and impossible candles',()=>{const b={time:'2026-01-01T00:00:00Z',open:100,high:101,low:99,close:100,volume:1};assert.equal(validateBars([b]).length,1);assert.throws(()=>validateBars([b,b]));assert.throws(()=>validateBars([{...b,high:90}]));assert.throws(()=>validateBars([{...b,time:'2099-01-01T00:00:00Z'}]));});
const dataset=JSON.parse(readFileSync(new URL('../data/QQQ.json',import.meta.url)));
test('backtest is causal and charges transaction costs',()=>{const original=backtest(dataset.bars,'breakout',{end:400}),modified=structuredClone(dataset.bars);for(let i=400;i<modified.length;i++)for(const k of ['open','high','low','close'])modified[i][k]*=3;assert.deepEqual(backtest(modified,'breakout',{end:400}),original);const gross=backtest(dataset.bars,'breakout',{feeBps:0,slippageBps:0}),net=backtest(dataset.bars,'breakout',{feeBps:2,slippageBps:2});assert.ok(gross.n>0);assert.equal(gross.n,net.n);assert.ok(net.totalR<gross.totalR);for(const t of net.trades)assert.ok(Date.parse(t.exitTime)>=Date.parse(t.time));});
test('final test data cannot alter the strategy selected on validation',()=>{const first=laboratory(dataset),changed=structuredClone(dataset);for(let i=Math.floor(changed.bars.length*.75);i<changed.bars.length;i++)for(const k of ['open','high','low','close'])changed.bars[i][k]*=2;const second=laboratory(changed);assert.equal(first.selected,second.selected);assert.deepEqual(first.results.map(r=>r.validation),second.results.map(r=>r.validation));for(const r of first.results)if(r.id===first.selected)assert.ok(r.validation.n>=20&&r.validation.expectancy>0);});
test('thirty-six real strategy rules expose actual checks and criteria readiness',()=>{
  assert.equal(strategies.length,41);
  for(const s of strategies){
    const bars=Array.from({length:80},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:100,high:101,low:99,close:100,volume:100}));
    const result=signal(bars,s.id);
    assert.equal(result.strategyName,s.name);
    assert.equal(result.side,'HOLD');
    assert.ok(result.checks.length>0);
    assert.equal(result.readiness.passed,result.checks.filter(c=>c.passed).length);
    assert.equal(result.readiness.total,result.checks.length);
    assert.equal(result.score,Math.round(result.readiness.passed/result.readiness.total*100));
  }
});

function candles(closes){return closes.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:closes[i-1]??close,high:Math.max(closes[i-1]??close,close)+.1,low:Math.min(closes[i-1]??close,close)-.1,close,volume:100}));}
function reflected(bars){return bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));}
const strategyFixtures={
  'ema-cross':candles([...Array(60).fill(100),...Array(20).fill(99),101]),
  macd:candles([...Array(60).fill(100),99.8,99.6,99.4,99.2,99,101]),
  'rsi-recovery':candles([...Array(60).fill(100),99,98,97,96,95,98]),
  squeeze:candles([...Array.from({length:60},(_,i)=>100+(i%2?1:-1)),...Array.from({length:20},(_,i)=>100+(i%2?.05:-.05)),102]),
  vwap:candles([...Array(60).fill(100),100.4,100.6,100.2,101.1])
};
strategyFixtures.squeeze.at(-1).volume=200;
strategyFixtures.vwap.at(-2).low=99.9;

for(const [id,bars] of Object.entries(strategyFixtures))test(id+' triggers deterministic bullish and bearish setups only after all criteria pass',()=>{
  for(const [input,expected] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    const result=signal(input,id);
    assert.equal(result.side,expected);
    assert.equal(result.score,100);
    assert.ok(result.checks.every(c=>c.passed));
    assert.deepEqual(signal(input,id),result);
    assert.equal(signal(input.slice(0,-1),id).side,'HOLD');
    assert.equal(result.time,input.at(-1).time);
    assert.ok(expected==='BUY'?result.stop<result.entry&&result.target>result.entry:result.stop>result.entry&&result.target<result.entry);
  }
});

test('missing volume blocks VWAP and a weak-volume squeeze remains HOLD',()=>{
  const noVolume=strategyFixtures.vwap.map(b=>({...b,volume:0})),vwap=signal(noVolume,'vwap');
  assert.equal(vwap.side,'HOLD');assert.equal(vwap.volumeConfirmed,false);assert.equal(vwap.checks[0].passed,false);
  const weak=structuredClone(strategyFixtures.squeeze);weak.at(-1).volume=50;
  const squeeze=signal(weak,'squeeze');assert.equal(squeeze.side,'HOLD');assert.equal(squeeze.readiness.passed,3);assert.equal(squeeze.readiness.total,4);assert.equal(squeeze.score,75);
});

test('indicator calculations match independent EMA, Wilder ATR, MACD and rolling volume arithmetic',()=>{
  const bars=Array.from({length:60},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:100,high:101,low:99,close:100,volume:100}));
  bars.push({time:new Date(Date.UTC(2026,0,1)+60*900000).toISOString(),open:100,high:103,low:99,close:102,volume:300});
  const q=indicators(bars),near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,actual+' ≠ '+expected);
  near(q.e9,100.4);near(q.e21,100+2/11);near(q.e50,100+4/51);near(q.atr,30/14);
  near(q.macd,2*(2/13-2/27));near(q.macdSignal,q.macd*.2);near(q.rsi,100);near(q.previousRsi,50);
  near(q.previousVwap,100);near(q.vwap,(19*100*100+(103+99+102)/3*300)/2200);
  near(q.high,101);near(q.low,99);assert.equal(q.volumeRatio,3);
});

test('every strategy is causal before a future boundary, including the new crossover series',()=>{
  const altered=structuredClone(dataset.bars);
  for(let i=400;i<altered.length;i++)for(const k of ['open','high','low','close'])altered[i][k]*=3;
  for(const s of strategies)assert.deepEqual(backtest(altered,s.id,{end:400}),backtest(dataset.bars,s.id,{end:400}),s.id);
});

test('all fourteen original strategies find both directions in the fixed historical dataset',()=>{
  for(const s of strategies.slice(0,14)){const observed=new Set();for(let i=60;i<dataset.bars.length;i++){observed.add(signal(dataset.bars.slice(0,i+1),s.id).side);if(observed.has('BUY')&&observed.has('SELL'))break;}assert.ok(observed.has('BUY')&&observed.has('SELL'),s.id);}
});

const expandedFixtures={
  supertrend:candles([...Array(60).fill(100),102]),
  stochastic:candles([...Array(60).fill(100),95,98]),
  'inside-bar':candles([...Array(60).fill(100),100,100.2,101.2]),
  'liquidity-sweep':candles([...Array(60).fill(100),100.05]),
  continuation:candles([...Array(60).fill(100),100.1,100.3,100.2,100.4,100.3,100.5,100.4,100.6,100.5,100.7,100.6,100.8,100.7,100.9,100.8,101,100.9,101.1,101,101.2,101.4]),
  'keltner-reentry':candles([...Array(60).fill(100),96,98.6])
};
Object.assign(expandedFixtures['inside-bar'].at(-3),{open:100,high:101,low:99,close:100});
Object.assign(expandedFixtures['inside-bar'].at(-2),{open:100,high:100.3,low:99.7,close:100.2});
Object.assign(expandedFixtures['liquidity-sweep'].at(-1),{open:99.9,high:100.1,low:99,close:100.05});

for(const [id,bars] of Object.entries(expandedFixtures))test(id+' has causal deterministic BUY/SELL fixtures and a structural invalidation',()=>{
  for(const [input,expected] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    const result=signal(input,id);assert.equal(result.side,expected);assert.equal(result.score,100);assert.ok(result.directionalChecks[expected].every(c=>c.passed));assert.ok(result.directionalChecks[expected==='BUY'?'SELL':'BUY'].some(c=>!c.passed));
    assert.deepEqual(signal(input,id,indicators(input)),result);assert.deepEqual(signal(input,id),result);assert.equal(result.riskModel,'structure');assert.equal(result.invalidation.price,result.stop);assert.equal(result.setup.confirmed,true);assert.equal(result.setup.entry,result.entry);
    assert.ok(Math.abs(Math.abs(result.target-result.entry)/result.riskDistance-result.rr)<1e-10);assert.ok(expected==='BUY'?result.stop<result.entry&&result.target>result.entry:result.stop>result.entry&&result.target<result.entry);
    const future={...input.at(-1),time:new Date(Date.parse(input.at(-1).time)+900000).toISOString(),close:500,high:600,low:1};assert.deepEqual(signal([...input,future].slice(0,input.length),id),result);
  }
});

test('Supertrend, fast stochastic and Keltner match independent technical formulas',()=>{
  const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-9,x+' ≠ '+y),st=indicators(expandedFixtures.supertrend),osc=indicators(expandedFixtures.stochastic),kc=indicators(expandedFixtures['keltner-reentry']);
  near(st.supertrend,101-3*((.2*9+2.2)/10));assert.equal(st.supertrendDirection,1);assert.equal(st.previousSupertrendDirection,-1);
  near(osc.previousStochastic,100*(95-94.9)/(100.1-94.9));near(osc.stochastic,100*(98-94.9)/(100.1-94.9));near(osc.stochasticD,(50+100*(95-94.9)/5.2+100*(98-94.9)/5.2)/3);
  const previousEma=100+(96-100)*2/21,previousAtr=(.2*13+4.2)/14,currentEma=previousEma+(98.6-previousEma)*2/21,currentAtr=(previousAtr*13+2.8)/14;
  near(kc.previousKeltnerLower,previousEma-2*previousAtr);near(kc.keltnerLower,currentEma-2*currentAtr);
});

test('inside-bar requires consecutive candles and continuation may persist without a new crossover',()=>{
  const gap=structuredClone(expandedFixtures['inside-bar']);for(let i=0;i<gap.length-2;i++)gap[i].time=new Date(Date.parse(gap[i].time)-86400000).toISOString();assert.equal(signal(gap,'inside-bar').side,'HOLD');
  const continuation=expandedFixtures.continuation,q=indicators(continuation);assert.ok(q.previousE9>q.previousE21);assert.equal(signal(continuation,'continuation').side,'BUY');assert.equal(signal(continuation,'ema-cross').side,'HOLD');
});

test('next-candle trigger equations use current completed indicators and never invent indicator-only entries',()=>{
  const bars=strategyFixtures['ema-cross'].slice(0,-1),q=indicators(bars),ema=setupTriggers(bars,'ema-cross'),macd=setupTriggers(bars,'macd');
  const cross=ema.BUY.price,fast=(1-2/10)*q.e9+2/10*cross,slow=(1-2/22)*q.e21+2/22*cross;assert.ok(Math.abs(fast-slow)<1e-10);assert.equal(ema.BUY.prerequisites[0].met,true);
  const price=macd.BUY.price,macdNext=((1-2/13)*q.e12+2/13*price)-((1-2/27)*q.e26+2/27*price);assert.ok(Math.abs(macdNext-q.macdSignal)<1e-10);
  for(const id of ['stochastic','vwap','continuation','keltner-reentry']){const triggers=setupTriggers(bars,id);for(const direction of ['BUY','SELL']){assert.equal(triggers[direction].price,null);assert.equal(triggers[direction].mode,'indicator');assert.ok(triggers[direction].condition.length>10);assert.equal(triggers[direction].conditional,true);}}
  const inside=setupTriggers(expandedFixtures['inside-bar'].slice(0,-1),'inside-bar');assert.equal(inside.BUY.price,101);assert.equal(inside.SELL.price,99);
  const channel=setupTriggers(bars,'breakout');assert.equal(channel.BUY.price,Math.max(...bars.slice(-20).map(b=>b.high)));assert.equal(channel.SELL.price,Math.min(...bars.slice(-20).map(b=>b.low)));
  const bands=setupTriggers(bars,'reversion');for(const [direction,key] of [['BUY','lower'],['SELL','upper']]){const close=bands[direction].price,last=bars.at(-1),next={time:new Date(Date.parse(last.time)+900000).toISOString(),open:last.close,high:Math.max(last.close,close)+.1,low:Math.min(last.close,close)-.1,close,volume:100};assert.ok(Math.abs(indicators([...bars,next])[key]-close)<1e-9);}
  const gappedInside=expandedFixtures['inside-bar'].slice(0,-1).map((b,i,a)=>i<a.length-1?{...b,time:new Date(Date.parse(b.time)-86400000).toISOString()}:b);assert.equal(setupTriggers(gappedInside,'inside-bar').BUY.price,null);
});

test('next-candle crossover levels remain exact when the 160-candle analysis window rolls',()=>{
  const bars=candles([500,...Array.from({length:159},(_,i)=>100+Math.sin(i/5))]);
  for(const id of ['ema-cross','macd']){
    const level=setupTriggers(bars,id).BUY.price,last=bars.at(-1),next={...last,time:new Date(Date.parse(last.time)+900000).toISOString(),open:last.close,close:level,high:Math.max(last.close,level)+.1,low:Math.min(last.close,level)-.1};
    const q=indicators([...bars,next].slice(-160));
    assert.ok(Math.abs(id==='ema-cross'?q.e9-q.e21:q.macd-q.macdSignal)<1e-9,id+' published crossing must match the actual next analysis window');
  }
});

test('backtest evaluates the same bounded history as the live signal before entering',()=>{
  const bars=candles([500,...Array(160).fill(100),100.3,100.3,100.3]),index=162;
  assert.equal(signal(bars.slice(0,index),'ema-cross').side,'HOLD');
  assert.equal(signal(bars.slice(index-160,index),'ema-cross').side,'BUY');
  const result=backtest(bars,'ema-cross',{start:index,feeBps:0,slippageBps:0});
  assert.equal(result.n,1,'the live EMA crossover must also produce a historical entry');
  assert.equal(result.trades[0].index,index);assert.equal(result.trades[0].signalTime,bars[index-1].time);
  assert.ok(Math.abs(result.trades[0].stop-99.99)<1e-9);
});

test('conditional ideas require their existing directional context and an actual compression',()=>{
  const down=reflected(expandedFixtures.continuation),pullback=setupTriggers(down,'pullback'),supertrend=setupTriggers(down,'supertrend');
  assert.ok(pullback.BUY.prerequisites.some(check=>!check.met),'aligned downtrend must not advertise a bullish pullback');
  assert.ok(supertrend.BUY.prerequisites.some(check=>!check.met),'bearish Supertrend cannot be labelled an established bullish setup');
  assert.ok(supertrend.SELL.prerequisites.every(check=>check.met));
  const expanded=candles([...Array.from({length:100},(_,i)=>100+Math.sin(i)*.05),...Array.from({length:20},(_,i)=>100+Math.sin(i)*2)]);
  for(const side of ['BUY','SELL'])assert.ok(setupTriggers(expanded,'squeeze')[side].prerequisites.some(check=>!check.met),'expanded bands are not a squeeze setup');
  const compressed=strategyFixtures.squeeze.slice(0,-1);for(const side of ['BUY','SELL'])assert.ok(setupTriggers(compressed,'squeeze')[side].prerequisites.every(check=>check.met));
  const noVolume=strategyFixtures.vwap.map(bar=>({...bar,volume:0}));for(const side of ['BUY','SELL'])assert.ok(setupTriggers(noVolume,'vwap')[side].prerequisites.some(check=>!check.met),'VWAP needs actual volume');
});

test('backtest preserves structural stops and rejects next-open fills already beyond invalidation',()=>{
  const setup=expandedFixtures['liquidity-sweep'],s=signal(setup,'liquidity-sweep'),base=Date.parse(setup.at(-1).time);
  // Keep the fill within the same 0.5 ATR drift limit as the live decision.
  const entryBar={time:new Date(base+900000).toISOString(),open:100.1,high:103,low:100,close:102,volume:100},tail={time:new Date(base+1800000).toISOString(),open:102,high:102.2,low:101.8,close:102,volume:100};
  const run=backtest([...setup,entryBar,tail],'liquidity-sweep',{feeBps:0,slippageBps:0});assert.equal(run.n,1);assert.equal(run.trades[0].stop,s.stop);assert.equal(run.trades[0].target,s.target);assert.ok(Math.abs(run.trades[0].distance-(100.1-s.stop))<1e-10);
  const invalidOpen={...entryBar,open:s.stop-.1,high:s.stop+.1,low:s.stop-.2,close:s.stop};assert.equal(backtest([...setup,invalidOpen,tail],'liquidity-sweep').n,0);
});

test('backtest waits for the next bar open and charges the explicit round-trip fee and adverse slippage',()=>{
  const bars=Array.from({length:60},(_,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:100,high:101,low:99,close:100,volume:100}));
  bars.push({time:new Date(Date.UTC(2026,0,1)+60*900000).toISOString(),open:100,high:103.2,low:99.8,close:103,volume:150});
  bars.push({time:new Date(Date.UTC(2026,0,1)+61*900000).toISOString(),open:103.8,high:110,low:103.5,close:105,volume:100});
  bars.push({time:new Date(Date.UTC(2026,0,1)+62*900000).toISOString(),open:105,high:106,low:104,close:105,volume:100});
  const result=backtest(bars,'breakout',{feeBps:10,slippageBps:5}),trade=result.trades[0];assert.equal(result.n,1);
  const entry=103.8*1.0005,signalRisk=((2*13+3.4)/14)*1.4,stop=103-signalRisk,target=103+signalRisk*1.8,distance=entry-stop,exit=target*.9995,stopExit=stop*.9995,riskUnit=entry-stopExit+(entry+stopExit)*.001,expected=(exit-entry-(entry+exit)*.001)/riskUnit;
  assert.ok(Math.abs(trade.stop-stop)<1e-10);assert.ok(Math.abs(trade.target-target)<1e-10);
  assert.equal(trade.signalTime,bars[60].time);assert.equal(trade.time,bars[61].time);assert.ok(Math.abs(trade.entry-entry)<1e-10);assert.ok(Math.abs(trade.exit-exit)<1e-10);assert.ok(Math.abs(trade.r-expected)<1e-10);
});

const newestFixtures={
  'adx-continuation':candles([...Array(60).fill(100),...Array.from({length:40},(_,i)=>100+(i+1)*.2)]),
  ichimoku:candles([...Array(78).fill(100),...Array.from({length:40},(_,i)=>100+(i+1)*.2)]),
  'cci-recovery':candles([...Array(60).fill(100),96,101.2]),
  aroon:candles([...Array(80).fill(100),106]),
  donchian55:candles([...Array(80).fill(100),102]),
  'roc-momentum':candles([...Array(80).fill(100),100.6])
};
newestFixtures.aroon.at(-26).high=105;
newestFixtures.aroon.at(-19).low=95;
for(const [id,bars] of Object.entries(newestFixtures))test(id+' confirms actual BUY and SELL with valid causal levels',()=>{
  for(const [input,expected] of [[bars,'BUY'],[reflected(bars),'SELL']]){
    const result=signal(input,id);assert.equal(result.side,expected,id+' '+result.reason);
    assert.ok(result.directionalChecks[expected].every(check=>check.passed));assert.equal(result.score,100);
    assert.equal(result.setup.confirmed,true);assert.equal(result.setup.entry,input.at(-1).close);
    assert.ok(expected==='BUY'?result.stop<result.entry&&result.target>result.entry:result.stop>result.entry&&result.target<result.entry);
    assert.ok(Math.abs((result.target-result.entry)/(result.entry-result.stop)-result.rr)<1e-9);
    assert.deepEqual(signal(input,id,indicators(input)),result);
    const future={...input.at(-1),time:new Date(Date.parse(input.at(-1).time)+900000).toISOString(),high:1000,low:1,close:500};
    assert.deepEqual(signal([...input,future].slice(0,input.length),id),result);
  }
});

test('ADX Wilder smoothing, CCI, Aroon and ROC match independent arithmetic',()=>{
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' ≠ '+expected),b=candles([...Array(60).fill(100),102,101.5,103]),q=indicators(b);
  const smoothTR1=(.2*13+2.2)/14,smoothTR2=(smoothTR1*13+.7)/14,smoothTR3=(smoothTR2*13+1.7)/14,plus1=2/14,plus2=plus1*13/14,plus3=(plus2*13+1)/14;
  near(q.diPlus,100*plus3/smoothTR3);near(q.diMinus,0);near(q.previousAdx,(100/14*13+100)/14);near(q.adx,(((100/14*13+100)/14)*13+100)/14);
  const cciBars=candles([...Array(60).fill(100),102]);Object.assign(cciBars.at(-1),{open:100,high:103,low:99,close:102});
  const typical=304/3,mean=(19*100+typical)/20,deviation=(19*Math.abs(100-mean)+Math.abs(typical-mean))/20;
  near(indicators(cciBars).cci,(typical-mean)/(.015*deviation));near(indicators(cciBars).previousCci,0);
  const aroonBars=candles(Array(80).fill(100));aroonBars[aroonBars.length-4].high=105;aroonBars[aroonBars.length-11].low=95;
  const aroon=indicators(aroonBars);near(aroon.aroonUp,88);near(aroon.aroonDown,60);
  const tied=structuredClone(aroonBars);tied.at(-1).high=105;near(indicators(tied).aroonUp,100);
  near(q.roc,3);near(q.previousRoc,1.5);
});

test('Ichimoku cloud is displaced from known t−26 data and is absent before 78 candles',()=>{
  const bars=candles(Array.from({length:100},(_,i)=>100+i*.5)),q=indicators(bars),near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' ≠ '+expected);
  near(q.tenkan,147.25);near(q.kijun,143);near(q.cloudA,(134.25+130)/2);near(q.cloudB,123.5);
  assert.equal(q.cloudSourceTime,bars.at(-27).time);assert.equal(q.chikouReference,bars.at(-27).close);
  const altered=structuredClone(bars);for(let i=74;i<altered.length;i++){altered[i].high+=200;altered[i].close+=100;}
  const changed=indicators(altered);near(changed.cloudA,q.cloudA);near(changed.cloudB,q.cloudB);
  const short=bars.slice(0,77);assert.equal(indicators(short).cloudA,null);assert.equal(indicators(short).cloudB,null);assert.equal(signal(short,'ichimoku').side,'HOLD');
});

test('new setups reject absent context and do not invent future OHLC-dependent trigger prices',()=>{
  const flat=candles(Array(80).fill(100));
  for(const id of Object.keys(newestFixtures)){const result=signal(flat,id);assert.equal(result.side,'HOLD',id);assert.ok(result.checks.some(check=>!check.passed));}
  for(const id of ['adx-continuation','ichimoku','cci-recovery','aroon'])for(const side of ['BUY','SELL']){const boundary=setupTriggers(flat,id)[side];assert.equal(boundary.price,null,id);assert.equal(boundary.mode,'indicator');assert.ok(boundary.prerequisites.length>0);}
  const channel=setupTriggers(newestFixtures.donchian55.slice(0,-1),'donchian55');assert.equal(channel.BUY.price,100.1);assert.equal(channel.SELL.price,99.9);
  const roc=setupTriggers(flat,'roc-momentum');assert.ok(Math.abs(roc.BUY.price-100.5)<1e-10);assert.ok(Math.abs(roc.SELL.price-99.5)<1e-10);
  assert.equal(roc.BUY.prerequisites[0].met,true);assert.equal(roc.SELL.prerequisites[0].met,true);
});

test('Donchian55 excludes the current candle and ROC trigger is exact under the rolling analysis window',()=>{
  const bars=candles([500,...Array(159).fill(100)]),boundary=setupTriggers(bars,'roc-momentum').BUY.price,last=bars.at(-1),next={...last,time:new Date(Date.parse(last.time)+900000).toISOString(),open:last.close,close:boundary,high:boundary+.1,low:99.9};
  assert.ok(Math.abs(indicators([...bars,next].slice(-160)).roc-.5)<1e-10);
  const breakout=newestFixtures.donchian55,result=signal(breakout,'donchian55');assert.equal(result.side,'BUY');assert.equal(result.triggerBuy,100.1);assert.equal(indicators(breakout).donchian55High,100.1);
  const spike=structuredClone(breakout);spike.at(-1).high=200;assert.equal(indicators(spike).donchian55High,100.1);
});

test('new strategies stay HOLD when their defining criterion is missing and do not repeat a crossing',()=>{
  const sameDirection=Object.fromEntries(Object.entries(newestFixtures).map(([id,bars])=>[id,structuredClone(bars)]));
  const adx=sameDirection['adx-continuation'];adx.at(-1).close=adx.at(-2).close;adx.at(-1).open=adx.at(-2).close;
  assert.equal(signal(adx,'adx-continuation').side,'HOLD','strong ADX alone is not an entry');
  const ichi=sameDirection.ichimoku;ichi.at(-1).close=ichi.at(-2).close;ichi.at(-1).open=ichi.at(-2).close;
  assert.equal(signal(ichi,'ichimoku').side,'HOLD','cloud alignment alone is not an entry');
  const cci=sameDirection['cci-recovery'];cci.at(-1).close=95;cci.at(-1).low=94.9;cci.at(-1).open=96;
  assert.equal(signal(cci,'cci-recovery').side,'HOLD','remaining beyond −100 is not recovery');
  const repeated=(bars,delta)=>{const previous=bars.at(-1),close=previous.close+delta;return [...bars,{time:new Date(Date.parse(previous.time)+900000).toISOString(),open:previous.close,high:close+.1,low:previous.close-.1,close,volume:100}];};
  assert.equal(signal(repeated(newestFixtures.aroon,.2),'aroon').side,'HOLD','Aroon trend persistence is not a fresh cross');
  assert.equal(signal(repeated(newestFixtures['roc-momentum'],.2),'roc-momentum').side,'HOLD','ROC stays beyond +0.5 without recrossing');
  const boundary=sameDirection.donchian55;boundary.at(-1).close=100.1;boundary.at(-1).open=100;
  assert.equal(signal(boundary,'donchian55').side,'HOLD','equal channel high is not a breakout');
});
