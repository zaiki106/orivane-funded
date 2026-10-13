// Kraken v2 sends OHLC updates on actual trades. A timer never invents market data.
const positive = x => Number.isFinite(x) && x > 0;
const iso = x => new Date(x).toISOString();

export class KrakenLiveFeed {
  constructor({symbols=['BTC/USD','ETH/USD'], interval=15, now=Date.now,
    WebSocketImpl=globalThis.WebSocket, onUpdate=()=>{}, onClosedBar=()=>{},
    staleAfterMs=15000, quoteStaleMs=30000, setTimer=setTimeout, clearTimer=clearTimeout,
    setRepeater=setInterval, clearRepeater=clearInterval}={}) {
    Object.assign(this,{symbols,interval,now,WebSocketImpl,onUpdate,onClosedBar,staleAfterMs,
      quoteStaleMs,setTimer,clearTimer,setRepeater,clearRepeater});
    this.markets=new Map(symbols.map(symbol=>[symbol,{quote:null,currentBar:null,closedTime:0,
      lastTradeId:0,lastTradeTime:0,lastEventAt:null}]));
    this.status='offline';this.socket=null;this.retryTimer=null;this.checkTimer=null;
    this.stopped=true;this.reconnects=0;this.failures=0;this.generation=0;
    this.connectedAt=null;this.lastMessageAt=null;this.error=null;this.detach=null;
  }

  seed(symbol,{bars=[],currentBar=null,quote=null}={}) {
    const market=this.markets.get(symbol);if(!market)return;
    market.closedTime=Math.max(market.closedTime,Date.parse(bars.at(-1)?.time)||0);
    if(currentBar&&(!market.currentBar||Date.parse(currentBar.time)>Date.parse(market.currentBar.time)))
      market.currentBar={...currentBar,closed:false,source:'Kraken REST OHLC',receivedAt:currentBar.receivedAt??iso(this.now()),transport:'rest'};
    if(quote&&!market.quote)market.quote={...quote,transport:'rest'};
  }

  start() {
    if(!this.stopped)return;
    this.stopped=false;this.connect();
    this.checkTimer=this.setRepeater(()=>this.check(),1000);this.checkTimer?.unref?.();
  }

  connect() {
    if(this.stopped)return;
    this.cleanupSocket();const generation=++this.generation;
    this.status=this.reconnects?'reconnecting':'connecting';this.connectingSince=this.now();
    this.onUpdate({type:'status'});
    let socket;
    try{socket=new this.WebSocketImpl('wss://ws.kraken.com/v2');}
    catch{return this.reconnect('Connexion Kraken indisponible');}
    this.socket=socket;
    const current=()=>!this.stopped&&this.socket===socket&&this.generation===generation;
    const open=()=>{if(!current())return;this.connectedAt=iso(this.now());this.lastMessageAt=null;
      for(const channel of ['ohlc','trade'])socket.send(JSON.stringify({method:'subscribe',params:{channel,
        symbol:this.symbols,snapshot:channel==='ohlc',...(channel==='ohlc'?{interval:this.interval}:{})}}));
    };
    const message=event=>{if(current())this.ingest(event.data);};
    const error=()=>{if(current())this.reconnect('Connexion Kraken interrompue');};
    const close=()=>{if(current())this.reconnect('Connexion Kraken fermée');};
    for(const [type,handler] of Object.entries({open,message,error,close}))socket.addEventListener(type,handler);
    this.detach=()=>{for(const [type,handler] of Object.entries({open,message,error,close}))socket.removeEventListener(type,handler);};
  }

  cleanupSocket() {
    this.detach?.();this.detach=null;const socket=this.socket;this.socket=null;
    if(socket&&socket.readyState<2)try{socket.close();}catch{}
  }

  reconnect(error,status='reconnecting') {
    if(this.stopped||this.retryTimer)return;
    this.error=error;this.status=status;this.cleanupSocket();this.reconnects++;this.failures++;
    for(const market of this.markets.values())if(market.currentBar)market.currentBar.interrupted=true;
    const delay=Math.min(30000,1000*2**Math.min(this.failures-1,5));
    this.retryTimer=this.setTimer(()=>{this.retryTimer=null;this.connect();},delay);
    this.retryTimer?.unref?.();this.onUpdate({type:'status'});
  }

  check() {
    if(this.stopped||this.retryTimer)return;
    const last=this.lastMessageAt?Date.parse(this.lastMessageAt):this.connectingSince;
    if(this.now()-last>this.staleAfterMs)this.reconnect('Aucun message Kraken récent','stale');
  }

  ingest(raw) {
    let message;
    try{message=typeof raw==='string'?JSON.parse(raw):raw;}catch{return false;}
    if(!message||typeof message!=='object')return false;
    if(message.method==='subscribe'&&message.success===false){this.reconnect('Abonnement Kraken refusé');return false;}
    if(!['heartbeat','status','ohlc','trade'].includes(message.channel)&&!(message.method==='subscribe'&&message.success))return false;
    const now=this.now();this.lastMessageAt=iso(now);this.status='live';this.error=null;this.failures=0;
    if(!Array.isArray(message.data))return false;
    let changed=false;
    if(message.channel==='ohlc'){
      const events=[...message.data].sort((a,b)=>Date.parse(a.interval_begin)-Date.parse(b.interval_begin));
      for(const value of events){
        const market=this.markets.get(value.symbol),time=Date.parse(value.interval_begin);
        const bar={time:Number.isFinite(time)?iso(time):null,open:Number(value.open),high:Number(value.high),
          low:Number(value.low),close:Number(value.close),volume:Number(value.volume),trades:Number(value.trades)};
        if(!market||value.interval!==this.interval||!Number.isFinite(time)||time>now+60000||
          ![bar.open,bar.high,bar.low,bar.close].every(positive)||!Number.isFinite(bar.volume)||bar.volume<0||
          !Number.isInteger(bar.trades)||bar.trades<0||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close))continue;
        const previous=market.currentBar,previousTime=Date.parse(previous?.time)||0;
        if(time<=market.closedTime||time<previousTime)continue;
        if(time===previousTime&&previous.transport==='websocket'&&!previous.interrupted&&
          (bar.volume<previous.volume||bar.trades<previous.trades||
            (bar.volume===previous.volume&&bar.trades===previous.trades)))continue;
        if(time>previousTime&&previous&&!previous.interrupted&&previous.transport==='websocket'&&previousTime+this.interval*60000<=now)this.closeBar(value.symbol,previous);
        const next={...bar,source:'Kraken WebSocket v2 · OHLC',transport:'websocket',receivedAt:iso(now),closed:false};
        if(time+this.interval*60000<=now){this.closeBar(value.symbol,next);market.currentBar=null;}
        else market.currentBar=next;
        market.lastEventAt=iso(now);this.onUpdate({type:'candle',symbol:value.symbol,currentBar:market.currentBar});changed=true;
      }
    }
    if(message.channel==='trade')for(const value of message.data){
      const market=this.markets.get(value.symbol),time=Date.parse(value.timestamp),price=Number(value.price),id=Number(value.trade_id);
      if(!market||!positive(price)||!Number.isFinite(time)||time>now+60000||!Number.isSafeInteger(id)||id<=market.lastTradeId||time<market.lastTradeTime)continue;
      market.lastTradeId=id;market.lastTradeTime=time;market.lastEventAt=iso(now);
      market.quote={price,bid:null,ask:null,receivedAt:iso(time),eventTime:iso(time),localReceivedAt:iso(now),
        source:'Kraken WebSocket v2 · trade',transport:'websocket',tradeId:id};
      this.onUpdate({type:'quote',symbol:value.symbol,quote:market.quote});changed=true;
    }
    return changed;
  }

  closeBar(symbol,bar) {
    const market=this.markets.get(symbol),time=Date.parse(bar.time);
    if(time<=market.closedTime)return;
    market.closedTime=time;this.onClosedBar(symbol,{...bar,closed:true});
  }

  snapshot(symbol) {
    const now=this.now();
    if(symbol){
      const market=this.markets.get(symbol);if(!market)return null;
      const ageMs=market.quote?Math.max(0,now-Date.parse(market.quote.receivedAt)):null;
      let status=this.status;
      if(status==='live'&&(!market.quote||market.quote.transport!=='websocket'))status='connecting';
      else if(status==='live'&&ageMs>this.quoteStaleMs)status='stale';
      const currentBar=market.currentBar&&Date.parse(market.currentBar.time)+this.interval*60000>now?{...market.currentBar}:null;
      return {status,transport:'websocket',provider:'Kraken WebSocket v2',lastEventAt:market.lastEventAt,
        ageMs,quote:market.quote?{...market.quote}:null,currentBar};
    }
    return {provider:'Kraken WebSocket v2',status:this.status,connectedAt:this.connectedAt,
      lastMessageAt:this.lastMessageAt,reconnects:this.reconnects,error:this.error};
  }

  stop() {
    this.stopped=true;++this.generation;
    if(this.retryTimer)this.clearTimer(this.retryTimer);
    if(this.checkTimer)this.clearRepeater(this.checkTimer);
    this.retryTimer=null;this.checkTimer=null;this.cleanupSocket();this.status='offline';
  }
}
