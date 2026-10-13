// Public broker quotes for real FX and metals only; never subscribe to synthetic symbols.
export const DERIV_SOURCE='Deriv public · forex / métaux';
export const DERIV_SYMBOLS={
  'EUR/USD':{id:'frxEURUSD',market:'forex',submarket:'major_pairs'},
  'GBP/USD':{id:'frxGBPUSD',market:'forex',submarket:'major_pairs'},
  'XAU/USD':{id:'frxXAUUSD',market:'commodities',submarket:'metals'}
};
const positive=x=>Number.isFinite(x)&&x>0;
const iso=x=>new Date(x).toISOString();

export class DerivLiveFeed{
  constructor({symbols=Object.keys(DERIV_SYMBOLS),interval=15,now=Date.now,
    WebSocketImpl=globalThis.WebSocket,onHistory=()=>{},onUpdate=()=>{},onClosedBar=()=>{},
    staleAfterMs=30000,quoteStaleMs=15000,setTimer=setTimeout,clearTimer=clearTimeout,
    setRepeater=setInterval,clearRepeater=clearInterval}={}){
    if(interval!==15||symbols.some(s=>!DERIV_SYMBOLS[s]))throw Error('Marché ou intervalle Deriv non autorisé');
    Object.assign(this,{symbols,interval,now,WebSocketImpl,onHistory,onUpdate,onClosedBar,
      staleAfterMs,quoteStaleMs,setTimer,clearTimer,setRepeater,clearRepeater});
    this.markets=new Map(symbols.map(symbol=>[symbol,{quote:null,currentBar:null,closedTime:0,
      lastTickEpoch:0,lastCandleEpoch:0,lastEventAt:null,verified:false,marketOpen:null}]));
    this.status='offline';this.stopped=true;this.socket=null;this.retryTimer=null;this.checkTimer=null;
    this.reconnects=0;this.failures=0;this.generation=0;this.nextReq=1;this.detach=null;
    this.connectedAt=null;this.lastMessageAt=null;this.lastPing=0;this.error=null;
  }
  canonical(id){return this.symbols.find(symbol=>DERIV_SYMBOLS[symbol].id===id);}
  seed(symbol,{bars=[]}={}){const m=this.markets.get(symbol);if(m)m.closedTime=Math.max(m.closedTime,Date.parse(bars.at(-1)?.time)||0);}
  start(){if(!this.stopped)return;this.stopped=false;this.connect();this.checkTimer=this.setRepeater(()=>this.check(),1000);this.checkTimer?.unref?.();}
  send(value){if(this.socket?.readyState===1)this.socket.send(JSON.stringify({...value,req_id:this.nextReq++}));}
  connect(){
    if(this.stopped)return;this.cleanupSocket();const generation=++this.generation;
    this.status=this.reconnects?'reconnecting':'connecting';this.connectingSince=this.now();this.onUpdate({type:'status'});
    let socket;try{socket=new this.WebSocketImpl('wss://api.derivws.com/trading/v1/options/ws/public');}
    catch{return this.reconnect('Connexion Deriv indisponible');}
    this.socket=socket;const current=()=>!this.stopped&&this.socket===socket&&this.generation===generation;
    const handlers={
      open:()=>{if(!current())return;this.connectedAt=iso(this.now());this.lastMessageAt=null;this.lastPing=this.now();this.send({active_symbols:'brief'});},
      message:event=>{if(current())this.ingest(event.data);},
      error:()=>{if(current())this.reconnect('Connexion Deriv interrompue');},
      close:()=>{if(current())this.reconnect('Connexion Deriv fermée');}
    };
    for(const [type,handler]of Object.entries(handlers))socket.addEventListener(type,handler);
    this.detach=()=>{for(const [type,handler]of Object.entries(handlers))socket.removeEventListener(type,handler);};
  }
  cleanupSocket(){this.detach?.();this.detach=null;const socket=this.socket;this.socket=null;if(socket&&socket.readyState<2)try{socket.close();}catch{}}
  reconnect(error,status='reconnecting'){
    if(this.stopped||this.retryTimer)return;this.error=error;this.status=status;this.cleanupSocket();this.reconnects++;this.failures++;
    for(const m of this.markets.values()){m.verified=false;if(m.currentBar)m.currentBar.interrupted=true;}
    this.retryTimer=this.setTimer(()=>{this.retryTimer=null;this.connect();},Math.min(30000,1000*2**Math.min(this.failures-1,5)));
    this.retryTimer?.unref?.();this.onUpdate({type:'status'});
  }
  check(){
    if(this.stopped||this.retryTimer)return;
    const last=this.lastMessageAt?Date.parse(this.lastMessageAt):this.connectingSince;
    if(this.now()-last>this.staleAfterMs)return this.reconnect('Aucun message Deriv récent','stale');
    if(this.now()-this.lastPing>=15000){this.lastPing=this.now();this.send({ping:1});}
  }
  bar(value,time=Number(value.epoch)*1000){
    const b={time:Number.isFinite(time)?iso(time):null,open:Number(value.open),high:Number(value.high),low:Number(value.low),close:Number(value.close),volume:0};
    if(!Number.isFinite(time)||time<0||time>this.now()+1000||time%(this.interval*60000)!==0||
      ![b.open,b.high,b.low,b.close].every(positive)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close))return null;
    return {...b,source:DERIV_SOURCE,transport:'websocket',receivedAt:iso(this.now()),volumeUnavailable:true};
  }
  ingest(raw){
    let message;try{message=typeof raw==='string'?JSON.parse(raw):raw;}catch{return false;}
    if(!message||typeof message!=='object')return false;
    if(message.error){this.error='Deriv : '+String(message.error.code??'données indisponibles');this.onUpdate({type:'status'});return false;}
    if(!['active_symbols','candles','ohlc','tick','ping'].includes(message.msg_type))return false;
    const now=this.now();this.lastMessageAt=iso(now);this.failures=0;
    if(message.msg_type==='active_symbols'){
      if(!Array.isArray(message.active_symbols))return false;
      for(const [symbol,m]of this.markets){const spec=DERIV_SYMBOLS[symbol],entry=message.active_symbols.find(x=>(x.underlying_symbol??x.symbol)===spec.id);
        m.verified=!!entry&&entry.market===spec.market&&entry.submarket===spec.submarket&&(entry.underlying_symbol_type??entry.market)===spec.market;
        m.marketOpen=entry?Boolean(entry.exchange_is_open)&&!entry.is_trading_suspended:null;
        if(!m.verified){this.error='Classification Deriv non vérifiée : '+symbol;continue;}
        this.send({ticks_history:spec.id,style:'candles',granularity:this.interval*60,count:1000,end:'latest',subscribe:1});
        this.send({ticks:spec.id,subscribe:1});
      }
      return true;
    }
    if(message.msg_type==='candles'){
      const symbol=this.canonical(message.echo_req?.ticks_history),m=this.markets.get(symbol);if(!m?.verified||!Array.isArray(message.candles))return false;
      const validated=message.candles.map(value=>this.bar(value)).filter(Boolean),closed=validated.filter(b=>Date.parse(b.time)+this.interval*60000<=now);
      if(!closed.length)return false;
      const distinct=[...new Map(closed.map(b=>[b.time,b])).values()].sort((a,b)=>a.time.localeCompare(b.time));
      m.closedTime=Math.max(m.closedTime,Date.parse(distinct.at(-1).time));
      const current=validated.find(b=>Date.parse(b.time)+this.interval*60000>now);
      m.currentBar=current?{...current,closed:false}:null;m.lastCandleEpoch=0;m.lastEventAt=iso(now);
      this.onHistory({symbol,source:DERIV_SOURCE,timeframe:this.interval,receivedAt:iso(now),bars:distinct,currentBar:m.currentBar,quote:m.quote,live:!!m.quote,
        market:DERIV_SYMBOLS[symbol].market,volumeUnavailable:true});
      this.onUpdate({type:'candle',symbol,currentBar:m.currentBar});return true;
    }
    if(message.msg_type==='ohlc'){
      const value=message.ohlc,symbol=this.canonical(value?.symbol),m=this.markets.get(symbol),epoch=Number(value?.epoch);
      if(!m?.verified||Number(value.granularity)!==this.interval*60||!Number.isSafeInteger(epoch)||epoch*1000>now+1000||epoch<m.lastCandleEpoch)return false;
      const b=this.bar(value,Number(value.open_time)*1000);if(!b)return false;
      const time=Date.parse(b.time),previous=m.currentBar,previousTime=Date.parse(previous?.time)||0;
      if(time<=m.closedTime||time<previousTime)return false;
      if(time===previousTime&&!previous.interrupted&&(b.high<previous.high||b.low>previous.low||b.open!==previous.open))return false;
      if(time===previousTime&&epoch===m.lastCandleEpoch&&['open','high','low','close'].every(k=>previous[k]===b[k]))return false;
      if(time>previousTime&&previous&&!previous.interrupted&&previousTime+this.interval*60000<=now)this.closeBar(symbol,previous);
      m.lastCandleEpoch=epoch;m.currentBar={...b,closed:false};m.lastEventAt=iso(now);
      this.onUpdate({type:'candle',symbol,currentBar:m.currentBar});return true;
    }
    if(message.msg_type==='tick'){
      const value=message.tick,symbol=this.canonical(value?.symbol),m=this.markets.get(symbol),epoch=Number(value?.epoch),price=Number(value?.quote),bid=Number(value?.bid),ask=Number(value?.ask);
      if(!m?.verified||!Number.isSafeInteger(epoch)||epoch*1000>now+1000||epoch<m.lastTickEpoch||!positive(price))return false;
      const validSpread=positive(bid)&&positive(ask)&&bid<=ask;
      if(epoch===m.lastTickEpoch&&m.quote?.price===price&&m.quote?.bid===(validSpread?bid:null)&&m.quote?.ask===(validSpread?ask:null))return false;
      m.lastTickEpoch=epoch;m.lastEventAt=iso(now);m.quote={price,bid:validSpread?bid:null,ask:validSpread?ask:null,receivedAt:iso(epoch*1000),eventTime:iso(epoch*1000),localReceivedAt:iso(now),source:DERIV_SOURCE,transport:'websocket'};
      this.status='live';this.error=null;this.onUpdate({type:'quote',symbol,quote:{...m.quote}});return true;
    }
    return false;
  }
  closeBar(symbol,bar){const m=this.markets.get(symbol),time=Date.parse(bar.time);if(time<=m.closedTime)return;m.closedTime=time;this.onClosedBar(symbol,{...bar,closed:true});}
  snapshot(symbol){
    if(symbol){const m=this.markets.get(symbol);if(!m)return null;
      const ageMs=m.quote?Math.max(0,this.now()-Date.parse(m.quote.receivedAt)):null;
      let status=this.status;if(status==='live'&&(!m.verified||!m.quote))status='connecting';else if(status==='live'&&ageMs>this.quoteStaleMs)status='stale';
      const currentBar=m.currentBar&&Date.parse(m.currentBar.time)+this.interval*60000>this.now()?{...m.currentBar}:null;
      return {status,transport:'websocket',provider:'Deriv public · real FX / metals',lastEventAt:m.lastEventAt,ageMs,quote:m.quote?{...m.quote}:null,currentBar,marketOpen:m.marketOpen,market:DERIV_SYMBOLS[symbol].market};
    }
    return {provider:'Deriv public · real FX / metals',status:this.status,connectedAt:this.connectedAt,lastMessageAt:this.lastMessageAt,reconnects:this.reconnects,error:this.error};
  }
  stop(){this.stopped=true;++this.generation;if(this.retryTimer)this.clearTimer(this.retryTimer);if(this.checkTimer)this.clearRepeater(this.checkTimer);this.retryTimer=null;this.checkTimer=null;this.cleanupSocket();this.status='offline';}
}
