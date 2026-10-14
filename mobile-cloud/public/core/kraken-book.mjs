import {MarketTelemetry} from './market-telemetry.mjs';
const decimal=/^\d+(?:\.\d+)?$/;
function plain(value){const s=String(value);if(decimal.test(s))return s;
  const match=/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);if(!match||Math.abs(Number(match[3]))>50)throw Error('Décimale invalide');
  const digits=match[1]+(match[2]??''),point=match[1].length+Number(match[3]);
  return point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);}
// A small JSON tokenizer quotes number tokens outside strings. Retaining the
// original decimal characters is necessary for Kraken's checksum protocol.
export function decodeBookJSON(raw){
  if(typeof raw!=='string'||raw.length>2000000)throw Error('Message carnet invalide');
  let result='',i=0;
  while(i<raw.length){const c=raw[i];if(c==='"'){const begin=i++;let escaped=false;
    while(i<raw.length){const x=raw[i++];if(!escaped&&x==='"')break;escaped=!escaped&&x==='\\';}
    result+=raw.slice(begin,i);continue;}
    if(c==='-'||c>='0'&&c<='9'){const m=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i));
      if(!m)throw Error('Nombre invalide');result+=JSON.stringify(m[0]);i+=m[0].length;continue;}
    result+=c;i++;
  }
  return JSON.parse(result);
}
function canonical(value){const s=plain(value);if(!decimal.test(s)||s.length>80)throw Error('Décimale invalide');
  const [a,b='']=s.split('.');return a.replace(/^0+(?=\d)/,'')+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):'');}
function compare(a,b){const [ai,af='']=canonical(a).split('.'),[bi,bf='']=canonical(b).split('.'),n=Math.max(af.length,bf.length);
  const x=BigInt(ai+af.padEnd(n,'0')),y=BigInt(bi+bf.padEnd(n,'0'));return x<y?-1:x>y?1:0;}
const crcTable=Array.from({length:256},(_,i)=>{let x=i;for(let n=0;n<8;n++)x=x&1?0xedb88320^(x>>>1):x>>>1;return x>>>0;});
export function crc32(input){let crc=0xffffffff;for(let i=0;i<input.length;i++)crc=crcTable[(crc^input.charCodeAt(i))&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function bookChecksum(asks,bids){const chunk=rows=>rows.slice(0,10).map(l=>[l.price,l.qty].map(v=>String(v).replace('.','').replace(/^0+/,'' )).join('')).join('');return crc32(chunk(asks)+chunk(bids));}
export class KrakenBook{
  constructor({symbol='BTC/USD',depth=100,now=Date.now}={}){this.symbol=symbol;this.depth=depth;this.now=now;this.telemetry=new MarketTelemetry();this.reset();}
  reset(reason='Snapshot requis'){this.bids=new Map();this.asks=new Map();this.status='awaiting-snapshot';this.checksumValid=false;this.reason=reason;this.receivedAt=null;this.eventTime=null;}
  ingest(raw){let m;try{m=typeof raw==='string'?decodeBookJSON(raw):raw;}catch{this.reset('Message invalide');return false;}
    if(m?.channel!=='book')return false;
    const item=m.data?.[0];if(item?.symbol!==this.symbol||!['snapshot','update'].includes(m.type))return false;
    if(m.type==='update'&&this.status!=='live')return false;
    try{
      if(!Array.isArray(item.asks)||!Array.isArray(item.bids)||item.asks.length+item.bids.length>10000)throw Error('Niveaux invalides');
      const asks=m.type==='snapshot'?new Map():new Map(this.asks),bids=m.type==='snapshot'?new Map():new Map(this.bids);
      for(const [levels,target]of [[item.asks,asks],[item.bids,bids]])for(const l of levels){const price=canonical(l.price),qty=canonical(l.qty);
        if(compare(price,'0')<=0||!Number.isFinite(Number(price))||!Number.isFinite(Number(qty)))throw Error('Niveaux invalides');
        if(qty==='0')target.delete(price);else target.set(price,{price:plain(l.price),qty:plain(l.qty)});}
      const orderedAsks=[...asks.values()].sort((a,b)=>compare(a.price,b.price)).slice(0,this.depth),orderedBids=[...bids.values()].sort((a,b)=>compare(b.price,a.price)).slice(0,this.depth);
      if(!orderedAsks.length||!orderedBids.length||compare(orderedBids[0].price,orderedAsks[0].price)>=0)throw Error('Carnet croisé ou vide');
      const checksum=Number(item.checksum);if(!Number.isInteger(checksum)||checksum<0||checksum>4294967295||bookChecksum(orderedAsks,orderedBids)!==checksum)throw Error('Checksum incorrect');
      if(m.type==='update'&&(!this.telemetry.observe(item.timestamp,this.now())||Date.parse(item.timestamp)<Date.parse(this.eventTime??0)))throw Error('Événement périmé');
      if(m.type==='snapshot'&&item.timestamp)this.telemetry.observe(item.timestamp,this.now());
      this.asks=new Map(orderedAsks.map(l=>[canonical(l.price),l]));this.bids=new Map(orderedBids.map(l=>[canonical(l.price),l]));
      this.status='live';this.checksumValid=true;this.reason=null;this.receivedAt=new Date(this.now()).toISOString();this.eventTime=item.timestamp??null;return true;
    }catch(e){this.reset(e.message);return false;}
  }
  snapshot(){const fresh=this.receivedAt!==null&&this.now()-Date.parse(this.receivedAt)<30000,status=this.status==='live'&&!fresh?'stale':this.status;
    const asks=[...this.asks.values()],bids=[...this.bids.values()],bestAsk=asks[0]?Number(asks[0].price):null,bestBid=bids[0]?Number(bids[0].price):null;
    return {symbol:this.symbol,source:'Kraken WebSocket v2 · book',status,checksumValid:this.checksumValid&&fresh,depth:this.depth,reason:this.reason,
      asks:status==='live'?asks.slice(0,20):[],bids:status==='live'?bids.slice(0,20):[],bestAsk:status==='live'?bestAsk:null,bestBid:status==='live'?bestBid:null,
      spread:status==='live'?bestAsk-bestBid:null,eventTime:this.eventTime,receivedAt:this.receivedAt,latency:this.telemetry.snapshot()};}
}
export class KrakenBookFeed{
  constructor({WebSocketImpl=globalThis.WebSocket,now=Date.now,onUpdate=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
    Object.assign(this,{WebSocketImpl,now,onUpdate,setTimer,clearTimer});this.book=new KrakenBook({now});this.stopped=true;this.failures=0;this.generation=0;}
  start(){if(!this.stopped)return;this.stopped=false;this.connect();}
  connect(){if(this.stopped)return;const generation=++this.generation;this.book.reset();let socket;
    try{socket=new this.WebSocketImpl('wss://ws.kraken.com/v2');}catch{return this.retry();}this.socket=socket;
    const current=()=>!this.stopped&&this.socket===socket&&this.generation===generation;
    socket.addEventListener('open',()=>{if(current())socket.send(JSON.stringify({method:'subscribe',params:{channel:'book',symbol:['BTC/USD'],depth:100,snapshot:true}}));});
    socket.addEventListener('message',e=>{if(!current())return;let message;try{message=decodeBookJSON(e.data);}catch{return this.retry();}
      if(message.method==='subscribe'&&message.success===false)return this.retry();
      if(message.channel==='book'){if(!this.book.ingest(message))return this.retry();this.failures=0;this.onUpdate(this.book.snapshot());}});
    for(const type of ['error','close'])socket.addEventListener(type,()=>{if(current())this.retry();});
  }
  retry(){if(this.stopped||this.timer)return;this.book.reset('Reconnexion requise');this.onUpdate(this.book.snapshot());const socket=this.socket;this.socket=null;
    if(socket&&socket.readyState<2)try{socket.close();}catch{}const delay=Math.min(30000,1000*2**Math.min(this.failures++,5));
    this.timer=this.setTimer(()=>{this.timer=null;this.connect();},delay);this.timer?.unref?.();}
  snapshot(){return this.book.snapshot();}
  stop(){this.stopped=true;++this.generation;if(this.timer)this.clearTimer(this.timer);this.timer=null;const socket=this.socket;this.socket=null;
    if(socket&&socket.readyState<2)try{socket.close();}catch{}this.book.reset('Flux arrêté');}
}
