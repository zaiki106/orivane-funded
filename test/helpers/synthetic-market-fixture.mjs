// Explicitly synthetic unit-test history. It is neither a provider feed nor a
// performance report, and must never be included in training or deployment.
export function createSyntheticMarketFixture({length=720,seed=7312025}={}){
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const start=Date.UTC(2025,0,1),bars=Array.from({length},(_,i)=>{
    const open=1000+i*.07+Math.sin(i*.2)*12+(random()-.5)*.15,close=open+Math.sin(i*.7)*1.8;
    const wick=1.7+random()*.6,volume=(500+(i%31)*4+random()*100)*(i%17===0?3:1);
    return {time:new Date(start+i*900000).toISOString(),open,close,high:Math.max(open,close)+wick,low:Math.min(open,close)-wick,volume,closed:true};
  });
  return {symbol:'QQQ',source:'Synthetic unit-test fixture',timeframe:15,bars,synthetic:true,testOnly:true,
    trainingAllowed:false,deploymentAllowed:false,provenance:{syntheticTestOnly:true,recipe:'seeded-lcg-waves-v1',seed},quality:{synthetic:true,gaps:0}};
}

// A positive TP outcome makes the normalized-R cost comparison meaningful:
// a stop loss alone can remain exactly -1 R after its risk includes costs.
export function createSyntheticExecutionFixture(){
  const start=Date.UTC(2025,0,1),bar=(i,open,high,low,close,volume=100)=>({time:new Date(start+i*900000).toISOString(),open,high,low,close,volume,closed:true,synthetic:true});
  return [...Array.from({length:60},(_,i)=>bar(i,100,101,99,100)),bar(60,100,103.2,99.8,103,200),bar(61,103.2,110,103.1,105),bar(62,105,106,104,105)];
}

// Independent seeded pullback geometry. The deep prior wick and small reclaim
// distinguish this rule from body-filtered momentum rules, without market data.
export function createSyntheticPullbackFixture(){
  const seed=97;let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const drift=(seed%13-6)*.07,sigma=.35+(seed%11)*.1,frequency=.04+(seed%9)*.055,start=Date.UTC(2025,0,1);let previous=100;
  const bars=Array.from({length:160},(_,i)=>{
    const shock=(random()+random()+random()-1.5)*sigma*(i>154?1+(seed%5):1),open=previous,close=Math.max(50,open+drift+Math.sin(i*frequency)*sigma*.6+shock),wick=.02+random()*sigma*.9,volume=Math.round(100*(.2+3*random())*(i===159&&seed%3===0?3:1));previous=close;
    return {time:new Date(start+i*900000).toISOString(),open,high:Math.max(open,close)+wick,low:Math.min(open,close)-wick,close,volume,closed:true,synthetic:true};
  });
  const p=bars.at(-2),x=bars.at(-1);p.open=p.close;p.high=p.close+.001;p.low=p.close-5;x.open=p.close;x.close=p.close+.01;x.high=x.close+.005;x.low=x.open-.005;
  return bars;
}
