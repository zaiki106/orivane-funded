import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportStrategyLab} from '../src/export-strategy-lab.mjs';
test('independent export never scans or labels calibration/final-test bars',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orivane-development-fixture-')),t=Date.UTC(2026,0,1),bars=Array.from({length:640},(_,i)=>{const close=100+i*.07+Math.sin(i*.35)*.25,open=100+(i-1)*.07+Math.sin((i-1)*.35)*.25;return {time:new Date(t+i*900000).toISOString(),open,close,high:Math.max(open,close)+.06,low:Math.min(open,close)-.06,volume:100+i%7,closed:true};});
 const dataset={symbol:'BTC/USD',source:'Controlled synthetic test fixture',synthetic:true,timeframe:15,bars},a=join(root,'source.json'),outA=join(root,'events-a.ndjson');
 await writeFile(a,JSON.stringify(dataset));const first=await exportStrategyLab(a,outA);
 assert.equal(first.rules.length,72);assert.ok(first.events>0);assert.equal(first.synthetic,true);assert.equal(first.usesFinalTest,false);assert.equal(first.paperPromotion,false);
 const changed=structuredClone(dataset);for(let i=320;i<640;i++)for(const k of ['open','close','high','low'])changed.bars[i][k]*=10;
 const b=join(root,'changed.json'),outB=join(root,'events-b.ndjson');await writeFile(b,JSON.stringify(changed));const second=await exportStrategyLab(b,outB);
 assert.equal(first.eventsSha256,second.eventsSha256);assert.notEqual(first.sourceSha256,second.sourceSha256);
 assert.equal(await readFile(outA,'utf8'),await readFile(outB,'utf8'));
 for(const row of (await readFile(outA,'utf8')).trim().split('\n').map(JSON.parse))assert.ok(row.entryTimeMs<first.developmentBoundaryMs);
});
