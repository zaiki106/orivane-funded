// Deterministic synthetic OHLC fixtures used only by tests, never live feeds.
export const candles=values=>values.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(close,values[i-1]??close)+.1,low:Math.min(close,values[i-1]??close)-.1,close,volume:0}));
export const reflected=bars=>bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
export const strategyFixtures={
  'parabolic-sar':candles([100.1,100,...Array(78).fill(100),102]),
  'williams-recovery':candles([...Array(80).fill(100),96,98.5]),
  'fisher-recovery':candles([...Array(80).fill(100),99,98,97,96,95,94,98]),
  trix:candles([...Array(80).fill(100),102]),
  tsi:candles([...Array(80).fill(100),102]),
  'dema-reclaim':candles([...Array(80).fill(100),102]),
  chandelier:candles([...Array(80).fill(100),102]),
  vortex:candles([...Array(80).fill(100),102])
};
Object.assign(strategyFixtures['williams-recovery'].at(-2),{open:96,high:96.1,low:95.9});

// These histories have distinct actual events under the router's ordered
// conditions. The parameters are fixed test examples, not fitted thresholds.
const parameters={
  // Later reversal isolates Fisher from the newly prioritized Stoch RSI event.
  'fisher-recovery':{frequency:.08,amplitude:.08,drift:0,end:181,reverse:true},
  vortex:{frequency:.08,amplitude:.08,drift:.005,end:137},
  tsi:{frequency:.08,amplitude:.08,drift:.005,end:138},
  trix:{frequency:.08,amplitude:.08,drift:.005,end:144},
  'dema-reclaim':{frequency:.08,amplitude:.08,drift:.005,end:217},
  'parabolic-sar':{frequency:.08,amplitude:.08,drift:.005,end:283},
  chandelier:{frequency:.08,amplitude:.08,drift:.02,end:82},
  'williams-recovery':{frequency:.12,amplitude:2,drift:.02,end:94}
};
export const routeFixtures=Object.fromEntries(Object.entries(parameters).map(([id,p])=>{
  const bars=candles(Array.from({length:p.end+1},(_,i)=>100+p.drift*i+p.amplitude*Math.sin(p.frequency*i)+p.amplitude*.23*Math.sin(i*.071))).slice(-160);
  return [id,p.reverse?reflected(bars):bars];
}));
