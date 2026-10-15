import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {intelligenceCatalog,loadEvidenceAudit,saveIntelligenceExperiment,runIntelligence} from '../src/intelligence-cli.mjs';
const execute=promisify(execFile);
test('real shipped evidence audit verifies artifacts and keeps unvalidated recipes separate',async()=>{
 const audit=await loadEvidenceAudit();assert.equal(audit.historicalStrategies,72);assert.equal(audit.newResearchStrategies.length,6);
 assert.equal(audit.evidence.profiles,72);assert.equal(audit.evidence.positiveNetProfiles,0);
 assert.equal(audit.models.length,3);assert.ok(audit.models.every(m=>m.paperAuthorized===false));
 assert.equal(intelligenceCatalog().capabilities.filter(c=>c.implemented).length,10);
});
test('experiments are content addressed, idempotent and refuse corrupted existing evidence',async t=>{
 const base=path.resolve('work');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'intelligence-test-'));
 assert.ok(directory.startsWith(base+path.sep));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const report={kind:'synthetic-test-only',value:1},first=await saveIntelligenceExperiment(directory,report,{seed:4}),second=await saveIntelligenceExperiment(directory,report,{seed:4});
 assert.deepEqual(first,second);assert.equal((await fs.readdir(directory)).length,1);
 const envelope=JSON.parse(await fs.readFile(first.path));assert.equal(envelope.report.value,1);assert.match(envelope.code['intelligence-ai.mjs'],/^[a-f0-9]{64}$/);
 await fs.writeFile(first.path,'changed');await assert.rejects(saveIntelligenceExperiment(directory,report,{seed:4}),/does not match/);
 assert.equal(await fs.readFile(first.path,'utf8'),'changed');
});
test('CLI executes actual catalog and rejects invalid commands or missing input',async()=>{
 const {stdout}=await execute(process.execPath,['src/intelligence-cli.mjs','catalog']);assert.equal(JSON.parse(stdout).strategies.length,6);
 await assert.rejects(execute(process.execPath,['src/intelligence-cli.mjs','research']),error=>error.code===1&&/requires --input/.test(error.stderr));
 await assert.rejects(runIntelligence(['bad']));await assert.rejects(runIntelligence(['audit','--shell','x']));
 await assert.rejects(runIntelligence(['catalog','--as-of','bad']));
});
test('batch CLI exposes isolated job failure with nonzero exit and intact JSON evidence',async t=>{
 const base=path.resolve('work');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'intelligence-batch-cli-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const input=path.join(directory,'batch.json');await fs.writeFile(input,JSON.stringify({datasets:[{symbol:'invalid'}]}));
 await assert.rejects(execute(process.execPath,['src/intelligence-cli.mjs','batch','--input',input,'--workers','1']),error=>{
  const report=JSON.parse(error.stdout);assert.equal(error.code,2);assert.equal(report.failed,1);assert.equal(report.results[0].status,'failed');return true;
 });
 await assert.rejects(runIntelligence(['audit','--workers','2']),/only to batch/);
});
test('terminal exposes new read-only catalog/audit endpoints with host and origin checks',async t=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['src/terminal-server.mjs'],{env:{...process.env,ORIVANE_TERMINAL_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Terminal startup timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error('Terminal exited '+code));});child.once('error',reject);});
 const url=`http://127.0.0.1:${port}`;
 const catalog=await fetch(url+'/research/intelligence/catalog');assert.equal(catalog.status,200);assert.equal((await catalog.json()).strategies.length,6);
 const audit=await fetch(url+'/research/intelligence/audit');assert.equal(audit.status,200);assert.equal((await audit.json()).historicalStrategies,72);
 assert.equal((await fetch(url+'/research/intelligence/catalog',{method:'HEAD'})).status,200);
 assert.equal((await fetch(url+'/research/intelligence/audit',{headers:{Origin:'https://external.invalid'}})).status,403);
 assert.equal((await fetch(url+'/research/intelligence/catalog',{method:'POST'})).status,405);
});
