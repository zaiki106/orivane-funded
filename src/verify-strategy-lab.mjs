// Independent streaming oracle for the Python aggregate report.
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [eventsPath,reportPath]=process.argv.slice(2);
if(!eventsPath||!reportPath)throw Error('Usage: node src/verify-strategy-lab.mjs EVENTS.ndjson REPORT.json');
const report=JSON.parse(await readFile(reportPath,'utf8')),manifest=JSON.parse(await readFile(eventsPath+'.manifest.json','utf8'));
assert.equal(report.policy.usesFinalTest,false);assert.equal(report.policy.promotesPaper,false);
assert.equal(report.sourceSha256,manifest.sourceSha256);assert.equal(report.eventsSha256,manifest.eventsSha256);
const hash=createHash('sha256'),stream=createReadStream(eventsPath);stream.on('data',chunk=>hash.update(chunk));
const stats=new Map();let count=0,lastTime=-Infinity;
for await(const line of createInterface({input:stream,crlfDelay:Infinity})){
 if(!line)continue;const row=JSON.parse(line);count++;
 assert.ok(row.entryTimeMs>=lastTime);lastTime=row.entryTimeMs;
 assert.ok(row.entryTimeMs<manifest.developmentBoundaryMs);
 if(row.censored)continue;
 assert.ok(Number.isFinite(row.netR)&&[0,1].includes(row.y));
 if(!report.folds.some(f=>row.entryTimeMs>=f.testFromMs&&row.entryTimeMs<f.testEndMs&&row.labelEndTimeMs<f.testEndMs))continue;
 for(const policy of ['align-if-available','context-only']){
  if(policy==='align-if-available'&&!row.h1Aligned)continue;
  const key=[row.strategy,policy,row.costMultiplier].join('|'),s=stats.get(key)??{busy:-Infinity,n:0,target:0,stop:0,expired:0,sum:0,gain:0,loss:0,equity:0,peak:0,drawdown:0};
  if(row.entryTimeMs<=s.busy)continue;
  s.busy=row.labelEndTimeMs;s.n++;s[row.status]++;s.sum+=row.netR;s.gain+=Math.max(0,row.netR);s.loss-=Math.min(0,row.netR);s.equity+=row.netR;s.peak=Math.max(s.peak,s.equity);s.drawdown=Math.max(s.drawdown,s.peak-s.equity);stats.set(key,s);
 }
}
assert.equal(count,manifest.events);assert.equal(count,report.events);assert.equal(hash.digest('hex'),report.eventsSha256);
let checked=0;
const near=(a,b)=>a===null||b===null?assert.equal(a,b):assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
for(const variant of report.results)for(const expected of variant.stress){
 const s=stats.get([variant.id,variant.h1Policy,expected.costMultiplier].join('|'));
 assert.equal(s?.n??0,expected.n);
 if(s){for(const key of ['target','stop','expired'])assert.equal(s[key],expected[key]);near(s.sum/s.n,expected.netExpectancyR);near(s.drawdown,expected.maxDrawdownR);near(s.target/s.n,expected.targetRate);near(s.loss?s.gain/s.loss:null,expected.profitFactor);}
 else assert.equal(expected.netExpectancyR,null);
 checked++;
}
console.log(JSON.stringify({passed:true,events:count,checkedProfiles:checked,basis:'independent Node streaming aggregation of actual private event lake'}));
