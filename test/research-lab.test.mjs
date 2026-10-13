import test from 'node:test';
import assert from 'node:assert/strict';
import {blockBootstrap,walkForwardResearch} from '../src/research-lab.mjs';
test('block resampling preserves constant outcomes, determinism and sample requirements',()=>{
 assert.deepEqual(blockBootstrap(Array(30).fill(2)).interval,[2,2]);
 const values=Array.from({length:40},(_,i)=>Math.sin(i));assert.deepEqual(blockBootstrap(values),blockBootstrap(values));
 assert.equal(blockBootstrap([1,2]).interval,null);assert.throws(()=>blockBootstrap([NaN]));
});
test('each walk-forward selection depends only on its chronological training prefix',()=>{
 const bars=Array.from({length:260},(_,i)=>{const close=100+i*.02+2*Math.sin(i*.18);return {time:new Date(Date.UTC(2025,0,1)+i*900000).toISOString(),open:close-.1,high:close+.2,low:close-.2,close,volume:100};});
 const before=walkForwardResearch({symbol:'TEST',bars});
 const changed=bars.map((b,i)=>i<130?b:{...b,open:b.open*1.2,high:b.high*1.2,low:b.low*1.2,close:b.close*1.2});
 const after=walkForwardResearch({symbol:'TEST',bars:changed});
 assert.equal(before.folds[0].selected,after.folds[0].selected);assert.deepEqual(before.folds[0].train,after.folds[0].train);
 for(const f of before.folds){assert.ok(Date.parse(f.trainThrough)<Date.parse(f.testFrom));if(f.test)for(const t of f.test.trades)assert.ok(Date.parse(t.time)>=Date.parse(f.testFrom));}
 assert.equal(before.confidenceUnchanged,true);
});
