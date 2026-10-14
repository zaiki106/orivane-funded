// Deterministic synthetic unit-test input. Never a price feed, production model, or performance report.
const end=Math.floor(Date.now()/900000)*900000;
const bars=Array.from({length:720},(_,i)=>{const open=1000+i*.07+Math.sin(i*.2)*12,close=open+Math.sin(i*.7)*1.8;return {time:new Date(end-(720-i)*900000).toISOString(),open,close,high:Math.max(open,close)+2,low:Math.min(open,close)-2,volume:500+(i%31)*4};});
export const fixture={symbol:'BTC/USD',source:'Kraken public · spot',timeframe:15,bars,quote:{price:bars.at(-1).close,receivedAt:new Date(end).toISOString(),transport:'rest'},provenance:{syntheticTestOnly:true},quality:{gaps:0}};
