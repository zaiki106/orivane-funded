// Observed level crossings are diagnostics. They are neither fills nor trade outcomes.
const MINUTE=60000;
const SIGNAL_INTERVAL=15*MINUTE;
const HORIZON=60*MINUTE;
const POLICY='confidence-above-60-v1';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500;
const timestamp=value=>typeof value==='string'?Date.parse(value):NaN;
const iso=value=>new Date(value).toISOString();
const validNow=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=8640000000000000;

function signalSnapshot(id,event,at) {
  if(!text(id)||!event||event.mode!=='observed-live'||event.policy!==POLICY||
    !['BUY','SELL'].includes(event.side)||!positive(event.confidencePercent)||event.confidencePercent<=60||event.confidencePercent>100||
    !text(event.symbol)||!text(event.source)||![event.entry,event.stop,event.target].every(positive))return null;
  const direction=event.side==='BUY'?1:-1;
  if(event.confidenceClass!=null&&event.confidenceClass!==(direction===1?'UP':'DOWN'))return null;
  if(direction*(event.entry-event.stop)<=0||direction*(event.target-event.entry)<=0)return null;
  const observed=timestamp(event.observedAt),signal=timestamp(event.signalTime),reference=timestamp(event.referenceTime),end=timestamp(event.horizonEndAt);
  if(![observed,signal,reference,end].every(Number.isFinite)||observed>at||at-observed>120000||
    reference!==signal+SIGNAL_INTERVAL||end!==reference+HORIZON||reference>observed||end<=at)return null;
  return {id,symbol:event.symbol,source:event.source,strategy:text(event.strategy)?event.strategy:null,
    strategyName:text(event.strategyName)?event.strategyName:null,side:event.side,confidencePercent:event.confidencePercent,
    policy:POLICY,entry:event.entry,stop:event.stop,target:event.target,signalTime:iso(signal),referenceTime:iso(reference),
    horizonEndAt:iso(end),signalObservedAt:iso(observed),createdAt:iso(at)};
}

function publicRow(row) {
  return {...JSON.parse(row.payload),status:row.status,lastQuoteAt:row.last_quote_at,
    lastObservationAt:row.last_observation_at,observedPrice:row.observed_price,observedAt:row.observed_at,
    expiresAt:row.horizon_end_at};
}

export class SignalFollowup {
  constructor(db,{now=Date.now}={}) {
    if(!db||typeof db.prepare!=='function'||typeof db.exec!=='function'||typeof now!=='function')throw new TypeError('SQLite database and clock required');
    this.db=db;this.now=now;
    db.exec(`CREATE TABLE IF NOT EXISTS signal_followups (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      horizon_end_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('watching','target-observed','stop-observed','expired')),
      last_quote_at TEXT,
      last_quote_received_at TEXT,
      last_quote_key TEXT,
      last_observation_at TEXT,
      observed_price REAL,
      observed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS signal_followups_market_status ON signal_followups(symbol,source,status);
    CREATE INDEX IF NOT EXISTS signal_followups_created ON signal_followups(created_at);`);
    const columns=new Set(db.prepare('PRAGMA table_info(signal_followups)').all().map(row=>row.name));
    for(const name of ['last_quote_received_at','last_quote_key'])if(!columns.has(name))db.exec('ALTER TABLE signal_followups ADD COLUMN '+name+' TEXT');
  }

  record(id,event) {
    const at=this.now();if(!validNow(at))return false;
    const snapshot=signalSnapshot(id,event,at);if(!snapshot)return false;
    const inserted=this.db.prepare(`INSERT OR IGNORE INTO signal_followups
      (id,symbol,source,payload,created_at,horizon_end_at,status)
      VALUES (?,?,?,?,?,?,'watching')`).run(id,snapshot.symbol,snapshot.source,JSON.stringify(snapshot),snapshot.createdAt,snapshot.horizonEndAt);
    return Number(inserted.changes)===1;
  }

  expire(at=this.now()) {
    if(!validNow(at))return 0;
    return Number(this.db.prepare("UPDATE signal_followups SET status='expired' WHERE status='watching' AND horizon_end_at<=?").run(iso(at)).changes);
  }

  observe(update,at=this.now()) {
    if(!validNow(at))return 0;
    let changed=this.expire(at);
    const {symbol,source,quote,fresh}=update??{};
    if(fresh!==true||!text(symbol)||!text(source)||!positive(quote?.price))return changed;
    const transport=quote.transport,budget=transport==='websocket'?30000:['rest','import'].includes(transport)?120000:null;
    const quoteAt=timestamp(quote.receivedAt),localAt=quote.localReceivedAt==null?null:timestamp(quote.localReceivedAt),
      eventAt=quote.eventTime==null?quoteAt:timestamp(quote.eventTime);
    if(budget===null||!Number.isFinite(quoteAt)||!Number.isFinite(eventAt)||quoteAt>at||eventAt>quoteAt||at-quoteAt>=budget||at-eventAt>=budget||
      (localAt!==null&&(!Number.isFinite(localAt)||localAt>at||localAt<quoteAt||at-localAt>=budget)))return changed;
    const rows=this.db.prepare("SELECT * FROM signal_followups WHERE symbol=? AND source=? AND status='watching'").all(symbol,source);
    const quoteKey=JSON.stringify([quote.price,positive(quote.bid)?quote.bid:null,positive(quote.ask)?quote.ask:null,Number.isSafeInteger(quote.tradeId)?quote.tradeId:null]);
    const write=this.db.prepare(`UPDATE signal_followups SET status=?,last_quote_at=?,last_quote_received_at=?,last_quote_key=?,last_observation_at=?,observed_price=?,observed_at=?
      WHERE id=? AND status='watching'`);
    for(const row of rows) {
      const creation=timestamp(row.created_at),lastQuote=timestamp(row.last_quote_at),lastReceipt=timestamp(row.last_quote_received_at),lastObservation=timestamp(row.last_observation_at);
      if(at<=creation||quoteAt<=creation||eventAt<=creation||
        (Number.isFinite(lastQuote)&&(quoteAt<lastQuote||eventAt<lastQuote))||
        (localAt!==null&&Number.isFinite(lastReceipt)&&localAt<=lastReceipt)||
        (Number.isFinite(lastObservation)&&at<=lastObservation))continue;
      // Deriv can deliver distinct ticks in one provider second. Order those only
      // by an actual later local receipt; repeated or ambiguous receipts stay closed.
      const sameProviderTime=Number.isFinite(lastQuote)&&(quoteAt===lastQuote||eventAt===lastQuote);
      if(sameProviderTime&&(localAt===null||!Number.isFinite(lastReceipt)||localAt<=lastReceipt||quoteKey===row.last_quote_key))continue;
      const original=JSON.parse(row.payload),direction=original.side==='BUY'?1:-1;
      const stopObserved=direction*(quote.price-original.stop)<=0,targetObserved=direction*(quote.price-original.target)>=0;
      const status=stopObserved?'stop-observed':targetObserved?'target-observed':'watching';
      const touched=status!=='watching';
      changed+=Number(write.run(status,iso(quoteAt),localAt===null?null:iso(localAt),quoteKey,iso(at),touched?quote.price:null,touched?iso(at):null,row.id).changes);
    }
    return changed;
  }

  snapshot({symbol=null,limit=100}={}) {
    const boundedLimit=Number.isInteger(limit)?Math.max(1,Math.min(500,limit)):100;
    const filtered=typeof symbol==='string',where=filtered?' WHERE symbol=?':'',parameters=filtered?[symbol]:[];
    const items=this.db.prepare('SELECT * FROM signal_followups'+where+' ORDER BY created_at DESC,rowid DESC LIMIT ?').all(...parameters,boundedLimit).map(publicRow);
    const counts=this.db.prepare('SELECT status,COUNT(*) AS count FROM signal_followups'+where+' GROUP BY status').all(...parameters);
    const summary={watching:0,targetObserved:0,stopObserved:0,expired:0,total:0};
    const names={watching:'watching','target-observed':'targetObserved','stop-observed':'stopObserved',expired:'expired'};
    for(const row of counts) {const count=Number(row.count);summary[names[row.status]]=count;summary.total+=count;}
    return {mode:'observed-levels',items,summary};
  }
}
