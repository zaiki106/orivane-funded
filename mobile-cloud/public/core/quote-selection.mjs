const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function valid(q,now){const time=Date.parse(q?.eventTime??q?.receivedAt);return q&&['rest','websocket'].includes(q.transport)&&positive(q.price)&&Number.isFinite(time)&&time<=now+1000&&[q.bid,q.ask].every(x=>x==null||positive(x))&&!(positive(q.bid)&&positive(q.ask)&&q.bid>q.ask);}
// Fresh exchange-timestamped streaming quotes take precedence. A stale stream
// cannot pin the displayed price when a newer valid REST observation arrives.
export function selectKrakenQuote(previous,incoming,{now=Date.now()}={}){
 const oldValid=valid(previous,now),newValid=valid(incoming,now),oldTime=Date.parse(previous?.eventTime??previous?.receivedAt),newTime=Date.parse(incoming?.eventTime??incoming?.receivedAt);
 if(oldValid&&previous.transport==='websocket'&&now-oldTime<30000)return previous;
 if(newValid&&(!oldValid||newTime>=oldTime))return incoming;
 return oldValid?previous:null;
}
export function restQuoteState(quote,{now=Date.now()}={}){
 if(quote?.transport!=='rest'||!valid(quote,now))return 'unavailable';
 return now-Date.parse(quote.receivedAt)<120000?'snapshot':'stale';
}
