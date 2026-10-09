import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelWorkerPool} from '../src/model-worker.mjs';
const begin=Math.floor(Date.now()/900000)*900000;
const dataset=symbol=>({symbol,source:'Deterministic worker fixture',timeframe:15,bars:Array.from({length:100},(_,i)=>({time:new Date(begin-(100-i)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:0}))});

test('model pool bounds parallel work and coalesces queued symbol versions without blocking the main thread',async()=>{
  const results=[],errors=[];let resolve;const done=new Promise(r=>resolve=r);
  const pool=new ModelWorkerPool({onResult:result=>{results.push(result);if(results.length===3)resolve();},onError:error=>{errors.push(error);resolve();}});
  try{pool.schedule(dataset('BTC/USD'),1);pool.schedule(dataset('EUR/USD'),1);pool.schedule(dataset('NDX'),1);pool.schedule(dataset('NDX'),2);
    assert.deepEqual(pool.snapshot(),{active:2,queued:1,concurrency:2});
    let timerFired=false;await new Promise(r=>setTimeout(()=>{timerFired=true;r();},1));assert.equal(timerFired,true);
    await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Worker completion timeout')),10000).unref())]);
    assert.deepEqual(errors,[]);assert.equal(results.length,3);assert.equal(results.find(result=>result.symbol==='NDX').version,2);assert.ok(results.every(result=>result.calibration&&Array.isArray(result.laboratory.results)));
  }finally{await pool.close();}
});

test('model pool shutdown terminates running work and rejects later scheduling',async()=>{
  let completed=0;const pool=new ModelWorkerPool({onResult:()=>completed++});pool.schedule(dataset('BTC/USD'),1);pool.schedule(dataset('EUR/USD'),1);await pool.close();pool.schedule(dataset('NDX'),2);assert.deepEqual(pool.snapshot(),{active:0,queued:0,concurrency:2});assert.equal(completed,0);
});

test('a newer provider version cancels obsolete work and exposes calibration before laboratory completion',async()=>{
  const phases=[],errors=[];let resolve;const done=new Promise(r=>resolve=r);
  const pool=new ModelWorkerPool({concurrency:1,onCalibration:result=>phases.push({phase:'calibration',result}),onResult:result=>{phases.push({phase:'complete',result});resolve();},onError:error=>{errors.push(error);resolve();}});
  try{pool.schedule(dataset('BTC/USD'),1);pool.schedule({...dataset('BTC/USD'),source:'Replacement provider'},2);await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Worker replacement timeout')),10000).unref())]);assert.deepEqual(errors,[]);assert.deepEqual(phases.map(item=>item.phase),['calibration','complete']);assert.ok(phases.every(item=>item.result.version===2&&item.result.source==='Replacement provider'));assert.equal(phases[0].result.laboratory,undefined);assert.ok(phases[1].result.laboratory);}
  finally{await pool.close();}
});
