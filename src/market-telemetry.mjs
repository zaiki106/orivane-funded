// The observed clock difference includes both network delay and clock skew.
// It is never presented as an exchange or colocation latency guarantee.
export function eventTimestampNs(value){
  if(typeof value!=='string')return null;
  const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if(!match)return null;
  const ms=Date.parse(match[1]+'Z');if(!Number.isFinite(ms))return null;
  return (BigInt(ms)*1000000n+BigInt((match[2]??'').padEnd(9,'0'))).toString();
}
export class MarketTelemetry{
  constructor({limit=256}={}){this.limit=limit;this.values=[];this.last=null;this.invalid=0;}
  observe(eventTime,receivedAt=Date.now()){
    const ns=eventTimestampNs(eventTime),ms=typeof receivedAt==='number'?receivedAt:Date.parse(receivedAt);
    if(ns===null||!Number.isFinite(ms)){this.invalid++;return false;}
    const delta=ms-Number(BigInt(ns)/1000000n);
    if(Math.abs(delta)>120000){this.invalid++;return false;}
    this.values.push(delta);if(this.values.length>this.limit)this.values.shift();
    this.last={eventTime,eventTimestampNs:ns,receivedAt:new Date(ms).toISOString(),observedDelayMs:delta};return true;
  }
  snapshot(){const sorted=[...this.values].sort((a,b)=>a-b),p=q=>sorted.length?sorted[Math.ceil(q*sorted.length)-1]:null;
    return {kind:'observed-clock-difference',sample:sorted.length,p50Ms:p(.5),p95Ms:p(.95),clockSynchronized:false,
      includesClockSkew:true,invalidEvents:this.invalid,...this.last};}
}
