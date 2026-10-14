import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const args=process.argv.slice(2),options={};
if(args.includes('--help')){console.log('node compare-lean.mjs [--input private-dataset.json] [--oracle lean-output.json] [--output comparison.json] [--core ../src/engine.mjs] [--limit 720]');process.exit(0);}
for(let i=0;i<args.length;i+=2){if(!['--input','--oracle','--output','--core','--limit'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid reference CLI arguments');options[args[i].slice(2)]=args[i+1];}
const local=(file)=>fileURLToPath(new URL(file,import.meta.url)),limit=Number(options.limit??720);
if(!Number.isInteger(limit)||limit<60||limit>720)throw Error('Limit must be between 60 and 720');
const coreCandidates=options.core?[path.resolve(options.core)]:[local('../src/engine.mjs'),local('../orivane-funded/src/engine.mjs')];let coreFile;
for(const candidate of coreCandidates){try{await fs.access(candidate);coreFile=candidate;break;}catch{}}
if(!coreFile)throw Error('Orivane native core missing; pass --core /absolute/path/engine.mjs');
const {indicators}=await import(pathToFileURL(coreFile).href),input=await fs.readFile(options.input?path.resolve(options.input):local('../orivane-data/experiments/BTC_USD-15m.json')),datasets=JSON.parse(input),selected=(Array.isArray(datasets)?datasets:[datasets]).find(d=>d.symbol==='BTC/USD'),data=selected?{...selected,bars:selected.bars?.slice(-limit)}:null,lean=JSON.parse((await fs.readFile(options.oracle?path.resolve(options.oracle):local('./lean-output.json'),'utf8')).replace(/^\uFEFF/,''));
const inputSha256=crypto.createHash('sha256').update(input).digest('hex');
if(lean.inputSha256&&lean.inputSha256!==inputSha256)throw Error('Oracle input SHA256 differs from comparison input');
if(!data||data.source!=='Kraken public · spot'||lean.synthetic!==false||lean.packageVersion!=='2.5.18164'||lean.source!==data.source||lean.bars!==data.bars.length)throw Error('Invalid real oracle provenance');
const byTime=new Map(lean.rows.map(r=>[r.time,r])),comparisons=[];
for(let i=59;i<data.bars.length;i++){const bar=data.bars[i],reference=byTime.get(bar.time),q=indicators(data.bars.slice(0,i+1));if(!reference||!q||reference.close!==bar.close||![q.mean,q.sd,reference.sma20,reference.sd20].every(Number.isFinite))throw Error('Missing comparable oracle observation');comparisons.push({time:bar.time,sma20:q.mean,leanSma20:reference.sma20,smaError:Math.abs(q.mean-reference.sma20),sd20:q.sd,leanSd20:reference.sd20,sdError:Math.abs(q.sd-reference.sd20)});}
const tolerance=1e-7,maxSma=Math.max(...comparisons.map(r=>r.smaError)),maxSd=Math.max(...comparisons.map(r=>r.sdError)),passed=!!comparisons.length&&maxSma<=tolerance&&maxSd<=tolerance;
const report={schemaVersion:1,generatedAt:new Date().toISOString(),status:passed?'passed':'failed',synthetic:false,orders:false,
 oracle:{engine:'QuantConnect.Indicators',package:'2.5.18164',commit:lean.commit,runtime:lean.runtime,powershell:lean.powershell,scope:'Two original indicator classes; not the full LEAN execution engine'},
 dataset:{symbol:data.symbol,source:data.source,timeframeMinutes:15,bars:data.bars.length,first:data.bars[0].time,last:data.bars.at(-1).time,inputSha256,limit},
 comparison:{reference:'Unmodified official SMA(20) and population StandardDeviation(20)',implementation:'Orivane indicators().mean and indicators().sd on causal prefixes',leanReady:lean.sample,orivaneWarmupBars:60,compared:comparisons.length,absoluteTolerance:tolerance,maxSmaError:maxSma,maxSdError:maxSd,passed},
 scopeLimits:['No win rate or profitability validation','No order execution or brokerage calls','No SDK, Docker, paid cloud or global runtime installation','EMA seeding conventions are not compared','A full LEAN engine launch still requires a compatible SDK/runtime/dependency setup'],last:comparisons.at(-1)};
await fs.writeFile(options.output?path.resolve(options.output):local('./comparison-real.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=1;
