import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

const marker='orivane-intelligence-batch-worker-v1';
const message=error=>String(error?.message??error??'Unknown worker failure').slice(0,2000);
const symbolOf=dataset=>{try{return typeof dataset?.symbol==='string'?dataset.symbol:null;}catch{return null;}};

// Only a specifically marked worker executes research. Importing this module
// creates no workers, writes no files and performs no publication or execution.
if(!isMainThread&&workerData?.kind===marker){
 try {
  const {researchIntelligence}=await import('./intelligence-research.mjs');
  const report=researchIntelligence(workerData.dataset,{asOf:workerData.asOf});
  parentPort.postMessage({status:'completed',report});
 } catch(error){parentPort.postMessage({status:'failed',error:message(error)});}
}

/** Bounded CPU research jobs. Results always retain input order. A completed job
 * can contain an insufficient-evidence report; it never promotes trading models.
 * Timeouts include worker startup and are per job. All slots are terminated
 * before reuse or resolution. Observer errors never change research results.
 */
export async function runResearchBatch(datasets,{workers=2,asOf=Date.now(),timeoutMs=120000,onProgress=()=>{}}={}){
 if(!Array.isArray(datasets)||datasets.length>8)throw new TypeError('Expected at most eight datasets');
 if(!Number.isInteger(workers)||workers<1||workers>4)throw new RangeError('workers must be an integer in 1..4');
 if(!Number.isSafeInteger(asOf)||asOf<0)throw new TypeError('asOf must be a nonnegative integer timestamp');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw new RangeError('timeoutMs must be an integer in 100..300000');
 if(typeof onProgress!=='function')throw new TypeError('onProgress must be a function');
 let totalBars=0;
 for(const dataset of datasets){
  const count=Array.isArray(dataset?.bars)?dataset.bars.length:0;
  if(count>20000)throw new RangeError('A dataset cannot exceed 20000 bars');
  totalBars+=count;
 }
 if(totalBars>50000)throw new RangeError('A batch cannot exceed 50000 total bars');
 // Snapshot the full bounded batch before asynchronous jobs or callbacks can
 // mutate later input datasets. Clone failures remain isolated job failures.
 const snapshots=datasets.map(dataset=>{
  try{return {dataset:structuredClone(dataset)};}catch(error){return {error:message(error)};}
 });
 let snapshotBars=0;
 for(const snapshot of snapshots){
  const length=Array.isArray(snapshot.dataset?.bars)?snapshot.dataset.bars.length:0;
  if(length>20000)throw new RangeError('Dataset snapshot exceeds 20000 bars');
  snapshotBars+=length;
 }
 if(snapshotBars>50000)throw new RangeError('Batch snapshot exceeds 50000 total bars');
 const count=Math.min(workers,datasets.length),results=Array(datasets.length);
 let next=0,completed=0,failed=0,active=0;
 const progress=(index,symbol,status)=>{
  try{Promise.resolve(onProgress({index,symbol,status,completed,failed,total:datasets.length,active})).catch(()=>{});}catch{/* Advisory observer only. */}
 };
 const execute=(index)=>new Promise(resolve=>{
  const snapshot=snapshots[index],symbol=symbolOf(snapshot.dataset??datasets[index]);let worker,timer,settled=false;
  active++;progress(index,symbol,'running');
  const finish=async result=>{
   if(settled)return;settled=true;clearTimeout(timer);
   // terminate also waits for exit; a timeout cannot silently leave CPU work
   // running behind a released concurrency slot.
   if(worker){try{await worker.terminate();}catch{/* Already exited. */}worker.removeAllListeners();}
   active--;if(result.status==='completed')completed++;else failed++;
   const final={index,symbol,...result};results[index]=final;
   progress(index,symbol,result.status);resolve(final);
  };
  try {
   if(snapshot.error)throw new Error(snapshot.error);
   const dataset=snapshot.dataset;
   timer=setTimeout(()=>{void finish({status:'timeout',error:`Research job exceeded ${timeoutMs} ms`});},timeoutMs);
   // This self-contained ESM worker needs no inherited CLI/test-runner flags;
   // explicit inheritance can include flags forbidden in worker_threads.
   worker=new Worker(new URL(import.meta.url),{workerData:{kind:marker,dataset,asOf},execArgv:[]});
   worker.on('message',result=>{
    if(result?.status==='completed'&&result.report&&typeof result.report==='object')void finish({status:'completed',report:result.report});
    else void finish({status:'failed',error:typeof result?.error==='string'?result.error:'Malformed research worker response'});
   });
   worker.on('error',error=>{void finish({status:'failed',error:message(error)});});
   worker.on('exit',code=>{void finish({status:'failed',error:`Research worker exited before delivering a report (code ${code})`});});
  } catch(error){void finish({status:'failed',error:message(error)});}
 });
 const consume=async()=>{while(next<datasets.length){const index=next++;await execute(index);}};
 await Promise.all(Array.from({length:count},()=>consume()));
 return {kind:'intelligence-batch',workers:count,results,completed,failed};
}
