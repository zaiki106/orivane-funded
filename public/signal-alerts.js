const POLICY='confidence-above-60-v1';
const MAX_SEEN=500;
const idValid=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const confidenceValid=value=>typeof value==='number'&&Number.isFinite(value)&&value>60&&value<=100&&Math.round(value*10)/10===value;
const timestamp=value=>typeof value==='string'&&value.length?Date.parse(value):NaN;
const textValid=value=>typeof value==='string'&&value.trim().length>0;
function levelsValid(value,side){
  if(![value?.entry,value?.stop,value?.target].every(positive))return false;
  return side==='BUY'?value.stop<value.entry&&value.entry<value.target:value.target<value.entry&&value.entry<value.stop;
}
function probabilitiesValid(confidence,direction){
  const probabilities=confidence?.classProbs,values=['UP','DOWN','FLAT'].map(key=>probabilities?.[key]);
  return values.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)&&Math.abs(values.reduce((sum,value)=>sum+value,0)-1)<=1e-6&&Math.round(probabilities[direction]*1000)/10===confidence.percent;
}

function eligible(event,state,now){
  if(event?.type!=='signal'||event.mode!=='observed-live'||event.policy!==POLICY||state?.signalPolicy?.id!==POLICY)return false;
  if(!['BUY','SELL'].includes(event.side)||!confidenceValid(event.confidencePercent)||!levelsValid(event,event.side))return false;
  const direction=event.side==='BUY'?'UP':'DOWN';
  if(event.confidenceClass!==direction||!textValid(event.symbol)||!textValid(event.source)||!textValid(event.strategy))return false;
  const observed=timestamp(event.observedAt),signalTime=timestamp(event.signalTime);
  if(!Number.isFinite(observed)||observed>now||now-observed>60000||!Number.isFinite(signalTime)||signalTime>observed)return false;
  const market=Array.isArray(state.radar)?state.radar.find(m=>m?.symbol===event.symbol):null,decision=market?.decision,c=decision?.confidence;
  if(!market||market.source!==event.source||market.live!==true||market.feed?.status!=='live'||market.provenance?.marketOpen===false)return false;
  if(decision?.side!==event.side||decision.strategy!==event.strategy||decision.time!==event.signalTime||decision.closed!==true||decision.provisional===true||decision.setup?.confirmed===false)return false;
  if(!levelsValid(decision,event.side)||c?.status!=='estimate'||c.class!==direction||!confidenceValid(c.percent)||!probabilitiesValid(c,direction))return false;
  const quote=market.quote,received=timestamp(quote?.receivedAt),ttl=quote?.transport==='websocket'?30000:120000;
  return positive(quote?.price)&&Number.isFinite(received)&&received<=now&&now-received<ttl;
}

/** Deduplicate observed live signals. Browser effects remain in the UI owner. */
export class SignalAlertTracker{
  #enabled=false;
  #baseline=true;
  #seen=new Set();
  #clock;
  constructor({enabled=false,now=Date.now,seenIds=[]}={}){
    this.#enabled=enabled===true;
    this.#clock=typeof now==='function'?now:Date.now;
    if(Array.isArray(seenIds))for(const id of seenIds)this.#remember(id);
  }
  setEnabled(enabled){this.#enabled=enabled===true;}
  seenIds(){return [...this.#seen];}
  #remember(id){
    if(!idValid(id)||this.#seen.has(id))return false;
    this.#seen.add(id);
    while(this.#seen.size>MAX_SEEN)this.#seen.delete(this.#seen.values().next().value);
    return true;
  }
  consume(state,{streamFresh=false,now=this.#clock()}={}){
    const items=Array.isArray(state?.signalHistory?.items)?state.signalHistory.items:[],alerts=[];
    // Server history arrives newest first. Remember oldest first to retain recent IDs.
    const chronological=[...items].sort((a,b)=>(timestamp(a?.observedAt)||0)-(timestamp(b?.observedAt)||0));
    for(const event of chronological){
      if(!this.#remember(event?.id))continue;
      if(this.#baseline||!this.#enabled||streamFresh!==true||!Number.isFinite(now)||!eligible(event,state,now))continue;
      alerts.push({id:event.id,symbol:event.symbol,side:event.side,confidencePercent:event.confidencePercent,strategyName:textValid(event.strategyName)?event.strategyName:event.strategy,observedAt:event.observedAt});
    }
    this.#baseline=false;
    return alerts;
  }
}
