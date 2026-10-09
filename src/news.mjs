import {createHash} from 'node:crypto';

export const NEWS_REFRESH_MS=300000;
export const NEWS_MAX_AGE_MS=30*86400000;
const USD_MARKETS=Object.freeze(['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX']);
const MAX_BYTES=262144,MAX_ITEMS=80,MAX_ENTRIES=1000,TIMEOUT_MS=8000;
const official=(id,name,url,documentation,symbols,category='macro')=>Object.freeze({id,name,url,documentation,symbols:Object.freeze(symbols),category,kind:'official'});
export const NEWS_SOURCES=Object.freeze([
  official('fed-policy','Federal Reserve','https://www.federalreserve.gov/feeds/press_monetary.xml','https://www.federalreserve.gov/feeds/feeds.htm',USD_MARKETS),
  official('fed-speeches','Federal Reserve · discours','https://www.federalreserve.gov/feeds/speeches.xml','https://www.federalreserve.gov/feeds/feeds.htm',USD_MARKETS),
  official('ecb','BCE','https://www.ecb.europa.eu/rss/press.html','https://www.ecb.europa.eu/home/html/rss.en.html',['EUR/USD']),
  official('boe-news','Bank of England','https://www.bankofengland.co.uk/rss/news','https://www.bankofengland.co.uk/rss',['GBP/USD']),
  official('boe-publications','Bank of England · publications','https://www.bankofengland.co.uk/rss/publications','https://www.bankofengland.co.uk/rss',['GBP/USD']),
  official('bls-cpi','BLS · inflation','https://www.bls.gov/feed/cpi.rss','https://www.bls.gov/feed/',USD_MARKETS),
  official('bls-employment','BLS · emploi','https://www.bls.gov/feed/empsit.rss','https://www.bls.gov/feed/',USD_MARKETS),
  official('nasdaq','Nasdaq Trader','https://www.nasdaqtrader.com/rss.aspx?feed=currentheadlines&categorylist=2','https://www.nasdaqtrader.com/Trader.aspx?id=NewsRSS',['NDX'],'market'),
  Object.freeze({id:'coindesk',name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss',documentation:'https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss',symbols:Object.freeze(['BTC/USD']),category:'crypto',kind:'publisher'})
]);

const iso=t=>new Date(t).toISOString();
const clock=value=>{const result=typeof value==='function'?value():value??Date.now();const time=result instanceof Date?result.getTime():Number(result);if(!Number.isFinite(time))throw Error('Horloge news invalide');return time;};
const entities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',euro:'€',pound:'£'});
function decode(value){
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
    if(key[0]!=='#')return entities[key.toLowerCase()]??whole;
    const code=key[1].toLowerCase()==='x'?Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10);
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';
  });
}
function text(value){
  return decode(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/[<>\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
function field(block,names){
  for(const name of names){const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'));if(match)return match[1];}
  return '';
}
function href(block){
  for(const match of block.matchAll(/<link\b([^>]*?)(?:\/>|>[\s\S]*?<\/link\s*>)/gi)){
    const attributes=match[1],rel=attributes.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2];
    if(rel&&rel!=='alternate')continue;
    const url=attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];if(url)return url;
  }
  return field(block,['link']);
}
function safeUrl(raw,source){
  const clean=decode(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')).trim();
  if(clean.length>2048||/[\u0000-\u0020\u007f<>]/.test(clean))return null;
  try{
    const url=new URL(clean),host=new URL(source.url).hostname.replace(/^www\./,'');
    if(url.username||url.password||url.port||url.hostname.replace(/^www\./,'')!==host)return null;
    // Nasdaq's official RSS still emits HTTP links; its HTTPS article endpoint is verified.
    if(url.protocol==='http:'&&host==='nasdaqtrader.com')url.protocol='https:';
    if(url.protocol!=='https:')return null;
    url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
    return url.href;
  }catch{return null;}
}
function relevance(title,source){
  if(source.id==='coindesk')return /\b(bitcoin|btc)\b/i.test(title)?{symbols:['BTC/USD'],basis:'title-keywords'}:null;
  if(source.id.startsWith('boe-')&&!/\b(monetary|inflation|interest|bank rate|rates|economic|economy|credit|liabilit\w*|financial stability|market\w*|reserves|decision maker|mpc|policy report)\b/i.test(title))return null;
  if(source.id==='nasdaq'&&!/\b(nasdaq.?100|ndx|trading hours|holiday|market closure|market.?wide|system|business continuity|regulation sci)\b/i.test(title))return null;
  return {symbols:[...source.symbols],basis:source.id==='nasdaq'?'title-keywords':'institution-scope'};
}
function publication(raw){
  const value=text(raw);
  // A date without an explicit zone is not a reliable publication timestamp.
  if(!/(?:Z|[+-]\d\d:?\d\d|GMT|UTC)\s*$/i.test(value))return NaN;
  return Date.parse(value);
}

export function parseNewsFeed(xml,{source,now=Date.now(),receivedAt,maxAgeMs=NEWS_MAX_AGE_MS}={}){
  const at=clock(now),received=receivedAt??iso(at);
  if(!source||typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES)throw Error('Flux news invalide ou trop volumineux');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Format news refusé');
  xml=xml.replace(/<!--[\s\S]*?-->/g,'');
  const root=xml.match(/<(rss|feed)\b/i)?.[1];
  if(!root||!new RegExp('</'+root+'\\s*>\\s*$','i').test(xml))throw Error('Format news refusé');
  const items=[],seen=new Set();let count=0;
  for(const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)){
    if(++count>MAX_ENTRIES)throw Error('Trop de titres dans le flux');
    const block=match[2],title=text(field(block,['title'])),url=safeUrl(href(block),source);
    const published=publication(field(block,match[1].toLowerCase()==='entry'?['published']:['pubDate']));
    if(!title||title.length>600||!url||!Number.isFinite(published)||published>at||at-published>maxAgeMs||seen.has(url))continue;
    const relevant=relevance(title,source);if(!relevant)continue;
    seen.add(url);items.push({id:createHash('sha256').update(url).digest('hex').slice(0,24),title,url,
      sourceId:source.id,source:source.name,sourceKind:source.kind,feedUrl:source.url,
      publishedAt:iso(published),receivedAt:received,symbols:relevant.symbols,relevanceBasis:relevant.basis,
      category:source.category});
  }
  if((xml.match(/<(?:item|entry)\b/gi)??[]).length!==count)throw Error('Flux news incomplet');
  return items.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,MAX_ITEMS);
}

async function cancelBody(response){try{await response.body?.cancel?.();}catch{}}
async function readLimited(response){
  const declared=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_BYTES){await cancelBody(response);throw Error('Flux news trop volumineux');}
  if(!response.body?.getReader)throw Error('Lecture bornée du flux indisponible');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BYTES){await reader.cancel();throw Error('Flux news trop volumineux');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks,total).toString('utf8');
}
async function abortable(work,signal){
  if(signal.aborted)throw signal.reason??Error('News interrompues');
  let cancel;const interrupted=new Promise((_,reject)=>{cancel=()=>reject(signal.reason??Error('News interrompues'));signal.addEventListener('abort',cancel,{once:true});});
  try{return await Promise.race([Promise.resolve().then(work),interrupted]);}finally{signal.removeEventListener('abort',cancel);}
}
async function fetchSource(source,{fetchImpl,now,signal,timeoutMs,maxAgeMs}){
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(Error('News timeout')),timeoutMs);
  const bounded=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  const checkedAt=iso(clock(now));
  try{
    const items=await abortable(async()=>{
      const response=await fetchImpl(source.url,{signal:bounded,redirect:'error',headers:{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml','user-agent':'Orivane local news reader/1.0'}});
      if(!response.ok){await cancelBody(response);throw Error('HTTP '+response.status);}
      const type=response.headers?.get?.('content-type')??'';
      if(type&&!/xml|rss|atom/i.test(type)){await cancelBody(response);throw Error('Réponse non XML');}
      const xml=await readLimited(response),receivedAt=iso(clock(now));
      return {items:parseNewsFeed(xml,{source,now:clock(now),receivedAt,maxAgeMs}),receivedAt};
    },bounded);
    return {source:{id:source.id,name:source.name,kind:source.kind,url:source.url,status:'ok',checkedAt,receivedAt:items.receivedAt,latestPublishedAt:items.items[0]?.publishedAt??null,itemCount:items.items.length,error:null},items:items.items};
  }catch(error){
    const message=bounded.aborted?(signal?.aborted?'Actualisation interrompue':'Délai de réponse dépassé'):String(error?.message??'Flux indisponible').slice(0,100);
    return {source:{id:source.id,name:source.name,kind:source.kind,url:source.url,status:'unavailable',checkedAt,receivedAt:null,latestPublishedAt:null,itemCount:0,error:message},items:[]};
  }finally{clearTimeout(timer);}
}
function unique(items,at,maxAgeMs){
  const ordered=items.filter(item=>Date.parse(item.publishedAt)<=at&&at-Date.parse(item.publishedAt)<=maxAgeMs).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  const urls=new Set(),titles=new Set();return ordered.filter(item=>{const title=item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(urls.has(item.url)||titles.has(title))return false;urls.add(item.url);titles.add(title);return true;}).slice(0,MAX_ITEMS);
}
export async function fetchNews({fetchImpl=globalThis.fetch,now=Date.now,signal,sources=NEWS_SOURCES,timeoutMs=TIMEOUT_MS,maxAgeMs=NEWS_MAX_AGE_MS}={}){
  if(typeof fetchImpl!=='function')throw Error('Client news indisponible');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isFinite(maxAgeMs)||maxAgeMs<0)throw Error('Limites news invalides');
  const results=await Promise.all(sources.map(source=>fetchSource(source,{fetchImpl,now,signal,timeoutMs,maxAgeMs}))),at=clock(now),ok=results.filter(result=>result.source.status==='ok').length;
  return {status:ok===sources.length?'ready':ok?'partial':'unavailable',items:unique(results.flatMap(result=>result.items),at,maxAgeMs),sources:results.map(result=>result.source),receivedAt:iso(at)};
}

export class NewsService{
  constructor({fetchImpl=globalThis.fetch,now=Date.now,onUpdate=()=>{},refreshMs=NEWS_REFRESH_MS,staleMs=NEWS_REFRESH_MS*3,sources=NEWS_SOURCES,maxAgeMs=NEWS_MAX_AGE_MS,timeoutMs=TIMEOUT_MS,setRepeater=setInterval,clearRepeater=clearInterval}={}){
    if(!Number.isFinite(refreshMs)||refreshMs<1000||!Number.isFinite(staleMs)||staleMs<refreshMs)throw Error('Fréquence news invalide');
    this.fetchImpl=fetchImpl;this.now=now;this.onUpdate=onUpdate;this.refreshMs=refreshMs;this.staleMs=staleMs;this.sources=sources;this.maxAgeMs=maxAgeMs;this.timeoutMs=timeoutMs;this.setRepeater=setRepeater;this.clearRepeater=clearRepeater;
    this.cache=new Map();this.sourceStates=new Map();this.lastAttemptAt=null;this.updatedAt=null;this.nextRefreshAt=null;this.timer=null;this.pending=null;this.controller=null;this.started=false;this.generation=0;
  }
  start(){if(this.started)return this;this.started=true;this.refresh();this.timer=this.setRepeater(()=>this.refresh(),this.refreshMs);this.timer?.unref?.();return this;}
  stop(){this.started=false;this.generation++;if(this.timer!==null)this.clearRepeater(this.timer);this.timer=null;this.controller?.abort();this.controller=null;this.pending=null;this.nextRefreshAt=null;}
  refresh(){
    if(this.pending)return this.pending;
    const generation=this.generation;this.lastAttemptAt=iso(clock(this.now));this.nextRefreshAt=this.started?iso(clock(this.now)+this.refreshMs):null;
    const controller=new AbortController();this.controller=controller;
    const run=async()=>{
      const result=await fetchNews({fetchImpl:this.fetchImpl,now:this.now,signal:controller.signal,sources:this.sources,maxAgeMs:this.maxAgeMs,timeoutMs:this.timeoutMs});
      if(generation!==this.generation)return this.snapshot();
      for(const state of result.sources){
        if(state.status==='ok'){this.cache.set(state.id,result.items.filter(item=>item.sourceId===state.id));this.sourceStates.set(state.id,state);}
        else{const prior=this.sourceStates.get(state.id);this.sourceStates.set(state.id,{...state,receivedAt:prior?.receivedAt??null,latestPublishedAt:prior?.latestPublishedAt??null,itemCount:this.cache.get(state.id)?.length??0});}
      }
      if(result.sources.some(source=>source.status==='ok'))this.updatedAt=result.receivedAt;
      const snapshot=this.snapshot();try{this.onUpdate(snapshot);}catch{}
      return snapshot;
    };
    const task=run();this.pending=task;
    task.finally(()=>{if(this.pending===task)this.pending=null;if(this.controller===controller)this.controller=null;}).catch(()=>{});
    return task;
  }
  snapshot(symbol){
    const at=clock(this.now),sources=this.sources.map(source=>{
      const state=this.sourceStates.get(source.id)??{id:source.id,name:source.name,kind:source.kind,url:source.url,status:this.pending?'loading':'unavailable',checkedAt:null,receivedAt:null,latestPublishedAt:null,itemCount:0,error:null};
      const ageMs=state.receivedAt?Math.max(0,at-Date.parse(state.receivedAt)):null;
      return {...state,status:ageMs!==null&&ageMs>this.staleMs?'stale':state.status,ageMs};
    });
    const byId=new Map(sources.map(source=>[source.id,source]));
    let items=unique([...this.cache.values()].flat(),at,this.maxAgeMs).map(item=>({...item,symbols:[...item.symbols],cached:byId.get(item.sourceId)?.status!=='ok',stale:byId.get(item.sourceId)?.status==='stale'}));
    if(symbol)items=items.filter(item=>item.symbols.includes(symbol));
    const ok=sources.filter(source=>source.status==='ok').length,status=this.sourceStates.size===0&&this.pending?'loading':ok===sources.length?'ready':ok?'partial':items.length?'stale':'unavailable';
    return {status,items,sources,updatedAt:this.updatedAt,lastAttemptAt:this.lastAttemptAt,nextRefreshAt:this.nextRefreshAt,ageMs:this.updatedAt?Math.max(0,at-Date.parse(this.updatedAt)):null,refreshMs:this.refreshMs};
  }
}
