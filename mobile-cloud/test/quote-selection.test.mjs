import test from 'node:test';import assert from 'node:assert/strict';import {selectKrakenQuote,restQuoteState} from '../public/core/quote-selection.mjs';
const now=Date.UTC(2026,9,13),q=(age,transport,price)=>({receivedAt:new Date(now-age).toISOString(),transport,price,bid:price-.1,ask:price+.1});
test('a stale WebSocket cannot overwrite a newer real REST snapshot',()=>{
 const old=q(60000,'websocket',100),next=q(1000,'rest',101);assert.equal(selectKrakenQuote(old,next,{now}),next);assert.equal(restQuoteState(next,{now}),'snapshot');
});
test('fresh streaming quotes retain precedence; older and malformed snapshots do not replace them',()=>{
 const fresh=q(1000,'websocket',100),next=q(0,'rest',101);assert.equal(selectKrakenQuote(fresh,next,{now}),fresh);
 const stale=q(60000,'websocket',100);assert.equal(selectKrakenQuote(stale,q(70000,'rest',99),{now}),stale);
 assert.equal(selectKrakenQuote(stale,{...next,bid:200},{now}),stale);assert.equal(selectKrakenQuote(null,{...next,price:NaN},{now}),null);
});
test('REST freshness expires and never becomes a streaming observation',()=>{
 assert.equal(restQuoteState(q(120000,'rest',100),{now}),'stale');assert.equal(restQuoteState(q(0,'websocket',100),{now}),'unavailable');assert.equal(restQuoteState(q(-2000,'rest',100),{now}),'unavailable');
});
