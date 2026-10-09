import {Worker,isMainThread,parentPort} from 'node:worker_threads';

if(!isMainThread){
  parentPort.on('message',async({dataset,version})=>{
    try{
      const [{laboratory},{calibrateDecision},{replayDecisions}]=await Promise.all([import('./engine.mjs'),import('./decision.mjs'),import('./decision-replay.mjs')]);
      const calibration=calibrateDecision(dataset),trainedAt=new Date().toISOString();
      parentPort.postMessage({phase:'calibration',symbol:dataset.symbol,version,source:dataset.source,calibration,trainedAt});
      const laboratoryResult=laboratory(dataset),replay=replayDecisions(dataset,calibration),stress=replayDecisions(dataset,calibration,{costMultiplier:2});
      replay.stress={costMultiplier:2,status:stress.status,metrics:stress.metrics,counts:stress.counts};
      parentPort.postMessage({phase:'complete',symbol:dataset.symbol,version,source:dataset.source,laboratory:laboratoryResult,replay,calibration,trainedAt});
    }catch(error){parentPort.postMessage({symbol:dataset.symbol,version,source:dataset.source,error:error.message});}
  });
}

// Latest queued version wins per symbol. At most two model fits can use CPU at once.
export class ModelWorkerPool {
  constructor({concurrency=2,onResult=()=>{},onCalibration=()=>{},onError=()=>{}}={}){
    this.concurrency=Math.min(2,Math.max(1,concurrency));this.onResult=onResult;this.onCalibration=onCalibration;this.onError=onError;
    this.queue=new Map();this.workers=new Set();this.stopped=false;
  }
  schedule(dataset,version){
    if(this.stopped)return;
    this.queue.set(dataset.symbol,{dataset:{symbol:dataset.symbol,source:dataset.source,timeframe:dataset.timeframe??15,bars:dataset.bars},version});
    for(const slot of this.workers)if(slot.job?.dataset.symbol===dataset.symbol&&slot.job.version!==version&&!slot.superseded){slot.superseded=true;slot.worker.terminate();}
    this.drain();
  }
  createWorker(){
    const worker=new Worker(new URL('./model-worker.mjs',import.meta.url));const slot={worker,job:null};this.workers.add(slot);worker.unref();
    worker.on('message',result=>{const job=slot.job;if(result.phase==='calibration'){if(!this.stopped&&job)this.onCalibration(result);return;}slot.job=null;if(!this.stopped&&job){if(result.error)this.onError({...result});else this.onResult(result);}this.drain();});
    worker.on('error',error=>{const job=slot.job;slot.job=null;this.workers.delete(slot);if(!this.stopped&&job&&!slot.superseded)this.onError({symbol:job.dataset.symbol,source:job.dataset.source,version:job.version,error:error.message});this.drain();});
    worker.on('exit',code=>{if(!this.workers.has(slot))return;this.workers.delete(slot);const job=slot.job;slot.job=null;if(!this.stopped&&job&&!slot.superseded)this.onError({symbol:job.dataset.symbol,source:job.dataset.source,version:job.version,error:'Processus de calcul arrêté ('+code+')'});this.drain();});
    return slot;
  }
  drain(){
    if(this.stopped)return;
    while(this.queue.size){
      let slot=[...this.workers].find(item=>!item.job);
      if(!slot&&this.workers.size<this.concurrency)slot=this.createWorker();
      if(!slot)return;
      const [symbol,job]=this.queue.entries().next().value;this.queue.delete(symbol);slot.job=job;slot.worker.postMessage(job);
    }
  }
  snapshot(){return {active:[...this.workers].filter(slot=>slot.job).length,queued:this.queue.size,concurrency:this.concurrency};}
  async close(){this.stopped=true;this.queue.clear();const workers=[...this.workers];this.workers.clear();await Promise.allSettled(workers.map(slot=>slot.worker.terminate()));}
}
