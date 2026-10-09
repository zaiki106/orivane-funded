import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_SOURCES,NEWS_REFRESH_MS,NEWS_MAX_AGE_MS,parseNewsFeed,fetchNews,NewsService} from '../src/news.mjs';

const at=Date.parse('2026-10-08T12:00:00Z'),source=NEWS_SOURCES[0],stamp='Thu, 08 Oct 2026 11:00:00 GMT';
const item=({title='Federal Reserve monetary policy update',url='https://www.federalreserve.gov/newsevents/one.htm',date=stamp}={})=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
const rss=(...entries)=>`<?xml version="1.0"?><rss version="2.0"><channel>${entries.join('')}</channel></rss>`;
const response=xml=>new Response(xml,{headers:{'content-type':'application/rss+xml'}});

test('RSS keeps provider publication and actual reception dates, decodes text and never returns HTML or a body',()=>{
  const xml=rss(item({title:'<![CDATA[Fed &amp; rates &#x2014; <b>outlook</b> <script>alert(1)</script>]]>',url:'<![CDATA[https://www.federalreserve.gov/newsevents/one.htm?utm_source=rss#part]]>'}));
  const [news]=parseNewsFeed(xml,{source,now:at});
  assert.equal(news.title,'Fed & rates — outlook');assert.equal(news.url,'https://www.federalreserve.gov/newsevents/one.htm');
  assert.equal(news.publishedAt,'2026-10-08T11:00:00.000Z');assert.equal(news.receivedAt,'2026-10-08T12:00:00.000Z');
  assert.equal(news.sourceKind,'official');assert.equal(news.relevanceBasis,'institution-scope');assert.ok(news.symbols.includes('XAU/USD'));
  assert.equal('description' in news,false);assert.equal('sentiment' in news,false);assert.equal('importance' in news,false);
});

test('Atom uses published instead of updated and accepts explicit timezone offsets',()=>{
  const bls=NEWS_SOURCES.find(s=>s.id==='bls-cpi'),xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>CPI inflation release</title><link rel="self" href="https://www.bls.gov/feed/cpi.rss"/><link rel="alternate" href="https://www.bls.gov/news.release/archives/cpi.htm"/><published>2026-10-08T07:30:00-04:00</published><updated>2026-10-08T11:59:00Z</updated></entry></feed>';
  const [news]=parseNewsFeed(xml,{source:bls,now:at});assert.equal(news.publishedAt,'2026-10-08T11:30:00.000Z');assert.equal(news.url,'https://www.bls.gov/news.release/archives/cpi.htm');
  assert.equal(parseNewsFeed(xml.replace(/<published>[\s\S]*?<\/published>/,''),{source:bls,now:at}).length,0);
});

test('future, missing, zoneless and expired publication dates are rejected, with no inferred date',()=>{
  const xml=rss(...['Thu, 08 Oct 2026 12:00:01 GMT','','2026-10-08T11:00:00','Thu, 01 Jan 2026 11:00:00 GMT','not a date'].map((date,i)=>item({date,url:`https://www.federalreserve.gov/${i}`})),item({date:new Date(at-NEWS_MAX_AGE_MS).toUTCString(),url:'https://www.federalreserve.gov/boundary'}));
  const news=parseNewsFeed(xml,{source,now:at});assert.equal(news.length,1);assert.ok(news[0].url.endsWith('/boundary'));
});

test('only HTTPS links on the publisher host survive; credentials, external hosts and schemes are refused',()=>{
  const bad=['javascript:alert(1)','data:text/html,fake','http://www.federalreserve.gov/one','https://www.federalreserve.gov.evil.test/one','https://user:pass@www.federalreserve.gov/one','https://www.federalreserve.gov:8443/one','https://evil.test/one','//www.federalreserve.gov/one','https://www.federalreserve.gov/&#10;one'];
  assert.equal(parseNewsFeed(rss(...bad.map(url=>item({url}))),{source,now:at}).length,0);
  const nasdaq=NEWS_SOURCES.find(s=>s.id==='nasdaq');const [news]=parseNewsFeed(rss(item({title:'Nasdaq market-wide trading hours update',url:'http://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-59'})),{source:nasdaq,now:at});
  assert.equal(news.url,'https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-59');
});

test('RSS entities remain plain text, comments are ignored and entity declarations or truncated XML fail',()=>{
  const [news]=parseNewsFeed(rss(item({title:'&lt;img src=x onerror=alert(1)&gt; Bitcoin &quot;news&quot; &apos;test&apos; &#38; &#0;'})),{source,now:at});
  assert.equal(news.title,'Bitcoin "news" \'test\' &');assert.equal(/[<>\u0000]/.test(news.title),false);
  assert.equal(parseNewsFeed(rss('<!--'+item()+'-->'),{source,now:at}).length,0);
  assert.throws(()=>parseNewsFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>'+rss(item()),{source,now:at}),/refusé/);
  assert.throws(()=>parseNewsFeed(rss(item()).slice(0,-6),{source,now:at}),/refusé/);
  assert.throws(()=>parseNewsFeed(rss(item(),'<item><title>broken</title>'),{source,now:at}),/incomplet/);
});

test('relevance is transparent source scope or title keywords, never a directional or impact rating',()=>{
  const crypto=NEWS_SOURCES.find(s=>s.id==='coindesk'),boe=NEWS_SOURCES.find(s=>s.id==='boe-news');
  const cryptoXml=rss(item({title:'Bitcoin ETF update',url:'https://www.coindesk.com/markets/bitcoin'}),item({title:'Ethereum update',url:'https://www.coindesk.com/markets/ethereum'}));
  const news=parseNewsFeed(cryptoXml,{source:crypto,now:at});assert.equal(news.length,1);assert.deepEqual(news[0].symbols,['BTC/USD']);assert.equal(news[0].sourceKind,'publisher');assert.equal(news[0].relevanceBasis,'title-keywords');
  const boeXml=rss(item({title:'New banknote animals announced',url:'https://www.bankofengland.co.uk/news/animals'}),item({title:'Monetary Policy Report',url:'https://www.bankofengland.co.uk/monetary/report'}));
  assert.deepEqual(parseNewsFeed(boeXml,{source:boe,now:at}).map(x=>x.title),['Monetary Policy Report']);
});

test('fetch aggregates real parsed items by publication, deduplicates URLs and titles, and exposes source failures',async()=>{
  const second=NEWS_SOURCES[1],third=NEWS_SOURCES[2],feeds=new Map([
    [source.url,rss(item(),item({title:'Earlier update',url:'https://www.federalreserve.gov/earlier',date:'Thu, 08 Oct 2026 10:00:00 GMT'}))],
    [second.url,rss(item({url:'https://www.federalreserve.gov/newsevents/one.htm?utm_source=x'}),item({title:'Earlier update',url:'https://www.federalreserve.gov/other'}))]
  ]);
  const data=await fetchNews({now:()=>at,sources:[source,second,third],fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal);return feeds.has(url)?response(feeds.get(url)):new Response('unavailable',{status:503});}});
  assert.equal(data.status,'partial');assert.equal(data.items.length,2);assert.equal(data.sources[2].status,'unavailable');assert.equal(data.sources[2].receivedAt,null);assert.equal(data.sources[2].error,'HTTP 503');
  assert.equal(data.items[0].publishedAt,'2026-10-08T11:00:00.000Z');assert.equal(data.receivedAt,'2026-10-08T12:00:00.000Z');
});

test('fetch bounds declared and streamed size, rejects HTML and times out even a noncooperative client',async()=>{
  const attempts=[
    async()=>new Response('small',{headers:{'content-type':'text/xml','content-length':'262145'}}),
    async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(262145));controller.close();}}),{headers:{'content-type':'text/xml'}}),
    async()=>new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}}),
    async()=>new Promise(()=>{})
  ];
  for(const fetchImpl of attempts){const data=await fetchNews({fetchImpl,sources:[source],now:()=>at,timeoutMs:20});assert.equal(data.status,'unavailable');assert.equal(data.items.length,0);assert.ok(data.sources[0].error);}
});

test('service preserves the last successful source cache and timestamps on failure, marks age, and filters markets',async()=>{
  let now=at,fail=false;const updates=[],service=new NewsService({sources:[source],now:()=>now,onUpdate:s=>updates.push(s),fetchImpl:async()=>{if(fail)throw Error('offline');return response(rss(item()));}});
  await service.refresh();assert.equal(service.snapshot().status,'ready');const received=service.snapshot().items[0].receivedAt;
  now+=NEWS_REFRESH_MS;fail=true;await service.refresh();let snapshot=service.snapshot();
  assert.equal(snapshot.status,'stale');assert.equal(snapshot.items[0].cached,true);assert.equal(snapshot.items[0].receivedAt,received);assert.equal(snapshot.sources[0].receivedAt,received);assert.equal(snapshot.updatedAt,received);
  assert.equal(service.snapshot('EUR/USD').items.length,1);assert.equal(service.snapshot('UNKNOWN').items.length,0);
  now+=NEWS_REFRESH_MS*3;snapshot=service.snapshot();assert.equal(snapshot.sources[0].status,'stale');assert.equal(snapshot.items[0].stale,true);
  now+=NEWS_MAX_AGE_MS;assert.equal(service.snapshot().items.length,0);assert.equal(service.snapshot().status,'unavailable');assert.equal(updates.length,2);
});

test('successful empty feeds replace old cache; failures never emit a misleading loading completion',async()=>{
  let fail=true,empty=false;const emitted=[],service=new NewsService({sources:[source],now:()=>at,onUpdate:s=>emitted.push(s.status),fetchImpl:async()=>{if(fail)throw Error('offline');return response(empty?rss():rss(item()));}});
  await service.refresh();assert.equal(emitted.at(-1),'unavailable');fail=false;await service.refresh();assert.equal(service.snapshot().items.length,1);
  empty=true;await service.refresh();assert.equal(service.snapshot().status,'ready');assert.equal(service.snapshot().items.length,0);
});

test('start uses one five-minute refresh, concurrent refreshes coalesce and stop aborts without late cache writes',async()=>{
  const handles=[],cleared=[],updates=[];let signal,calls=0;
  const service=new NewsService({sources:[source],now:()=>at,onUpdate:s=>updates.push(s),fetchImpl:async(_,options)=>{calls++;signal=options.signal;return new Promise(()=>{});},setRepeater:(fn,ms)=>{const handle={fn,ms,unref(){}};handles.push(handle);return handle;},clearRepeater:handle=>cleared.push(handle)});
  service.start();service.start();const pending=service.refresh();assert.equal(service.refresh(),pending);assert.equal(handles.length,1);assert.equal(handles[0].ms,300000);assert.equal(service.snapshot().status,'loading');
  await Promise.resolve();assert.equal(calls,1);service.stop();assert.equal(signal.aborted,true);await pending;
  assert.equal(cleared.length,1);assert.equal(updates.length,0);assert.equal(service.snapshot().items.length,0);assert.equal(service.snapshot().nextRefreshAt,null);
});
