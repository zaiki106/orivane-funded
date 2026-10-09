// Deterministic synthetic OHLC fixtures for tests only, never feed data.
export const candles=values=>values.map((close,i)=>({time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:values[i-1]??close,high:Math.max(close,values[i-1]??close)+.1,low:Math.min(close,values[i-1]??close)-.1,close,volume:0}));
export const reflected=bars=>bars.map(bar=>({...bar,open:200-bar.open,high:200-bar.low,low:200-bar.high,close:200-bar.close}));
// Each terminal candle contains a distinct event among the eight v8 rules.
// These fixed examples exercise rules; they never determine rule thresholds.
const parameters={
  'elder-ray':{frequency:.08,amplitude:.08,drift:0,end:80},
  'stoch-rsi':{frequency:.08,amplitude:.08,drift:0,end:142},
  'kama-reclaim':{frequency:.08,amplitude:.08,drift:.005,end:132},
  ppo:{frequency:.08,amplitude:.3,drift:.06,end:140},
  demarker:{frequency:.08,amplitude:.3,drift:.005,end:143},
  awesome:{frequency:.08,amplitude:.8,drift:.005,end:152},
  'ultimate-recovery':{frequency:.12,amplitude:4,drift:.06,end:91},
  smi:{frequency:.2,amplitude:.3,drift:.02,end:85}
};
export const routeFixtures=Object.fromEntries(Object.entries(parameters).map(([id,p])=>[id,candles(Array.from({length:p.end+1},(_,i)=>100+p.drift*i+p.amplitude*Math.sin(p.frequency*i)+p.amplitude*.23*Math.sin(i*.071))).slice(-160)]));
export const strategyFixtures=routeFixtures;
