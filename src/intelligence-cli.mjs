import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {researchIntelligence,auditPublishedResearch,intelligenceResearchVersion} from './intelligence-research.mjs';
import {intelligenceStrategies,intelligenceStrategiesVersion} from './intelligence-strategies.mjs';
import {fitRegimes,inferRegime,distributionDrift,calibratePredictionSets,predictionSet,adaptiveEnsemble} from './intelligence-ai.mjs';
import {portfolioRisk,allocateResearchRisk} from './intelligence-risk.mjs';
import {runResearchBatch} from './intelligence-jobs.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const modules=['intelligence-cli.mjs','intelligence-research.mjs','intelligence-learning.mjs','intelligence-ai.mjs','intelligence-strategies.mjs','intelligence-risk.mjs','intelligence-jobs.mjs','trade-outcome.mjs','execution-plan.mjs','cost-policy.mjs','engine.mjs'];
export function intelligenceCatalog(){
 return {version:intelligenceResearchVersion,strategyVersion:intelligenceStrategiesVersion,strategies:intelligenceStrategies,
  capabilities:[
   {id:'regimes',technology:'standardized deterministic k-means',implemented:true,purpose:'Fit market contexts on development observations and infer with a frozen scaler.'},
   {id:'supervised',technology:'regularized binary logistic regression',implemented:true,purpose:'Compare three fixed regularization variants using chronological selection.'},
   {id:'contextual-rates',technology:'strategy/regime empirical Bayes shrinkage',implemented:true,purpose:'Regularize sparse strategy/regime outcome rates toward the training prior.'},
   {id:'ensemble',technology:'completed-outcome recency-weighted Brier ensemble',implemented:true,purpose:'Weight research predictors using only outcomes available before a fixed cutoff.'},
   {id:'drift',technology:'reference-fitted PSI with out-of-range buckets',implemented:true,purpose:'Measure distribution changes without presenting PSI as a significance test.'},
   {id:'uncertainty',technology:'binary split conformal prediction sets',implemented:true,purpose:'Report ambiguity on a separate calibration split; time-series coverage is not guaranteed.'},
   {id:'portfolio',technology:'synchronized correlations and historical expected shortfall',implemented:true,purpose:'Measure gross stop exposure and signed historical scenario losses.'},
   {id:'allocation',technology:'capped inverse-volatility risk allocation',implemented:true,purpose:'Limit duplicate symbols and concentration; preserve unallocated risk budget.'},
   {id:'experiments',technology:'immutable content-addressed JSON manifests with SHA256',implemented:true,purpose:'Record exact source, code fingerprint, configuration and outcome.'},
   {id:'parallel-jobs',technology:'bounded Node.js worker_threads',implemented:true,purpose:'Run up to four independent research jobs with per-job timeout and isolated failures.'}],
  execution:{researchOnly:true,paperPromotion:false,realTradingAuthorized:false},
  historicalValidation:'The six recipes are research variants of known families; implementation tests are not evidence of profitability.'};
}

export async function loadEvidenceAudit(){
 const research=await readJson(path.join(root,'mobile-cloud/public/reports/strategy-lab.json'));
 const index=await readJson(path.join(root,'mobile-cloud/public/models/index.json'));
 const platform=await readJson(path.join(root,'mobile-cloud/public/platform.json'));
 const descriptor=Object.values(platform).filter(Array.isArray).flat().find(v=>v&&typeof v==='object'&&v.url==='/reports/strategy-lab.json');
 if(!descriptor||descriptor.url!=='/reports/strategy-lab.json'||descriptor.sha256!==digest(await fs.readFile(path.join(root,'mobile-cloud/public/reports/strategy-lab.json'))))throw Error('Shipped research SHA256 mismatch');
 if(!Array.isArray(index.models))throw Error('Invalid shipped model manifest');
 const models=[];
 for(const reference of index.models){
  if(!/^\/models\/[a-f0-9]+\.json$/.test(reference.url)||!(/^[a-f0-9]{64}$/).test(reference.sha256))throw Error('Invalid shipped model identity');
  const bytes=await fs.readFile(path.join(root,'mobile-cloud/public',reference.url.slice(1)));
  if(digest(bytes)!==reference.sha256)throw Error('Shipped model SHA256 mismatch');models.push(JSON.parse(bytes));
 }
 return auditPublishedResearch(research,models);
}
async function readJson(file){
 const handle=await fs.open(file,'r');try{if((await handle.stat()).size>32_000_000)throw Error('Input exceeds the explicit 32 MB research limit');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
}

export async function saveIntelligenceExperiment(directory,report,configuration={}){
 const code={};for(const name of modules)code[name]=digest(await fs.readFile(path.join(root,'src',name)));
 const payload={schemaVersion:1,kind:'orivane-intelligence-experiment',version:intelligenceResearchVersion,code,configuration,report},bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),sha256=digest(bytes),id=sha256.slice(0,24);
 const destination=path.resolve(directory);await fs.mkdir(destination,{recursive:true});
 const target=path.join(destination,id+'.json'),temporary=path.join(destination,`.${id}.${randomUUID()}.partial`);
 try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;const existing=await fs.readFile(target);if(digest(existing)!==sha256)throw Error('Existing experiment does not match its identity; preserved');}
 finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {id,path:target,sha256,bytes:bytes.length};
}

export async function runIntelligence(argv){
 const [command='catalog',...rest]=argv,options={};
 for(let i=0;i<rest.length;i+=2){if(!['--input','--output','--as-of','--workers'].includes(rest[i])||!rest[i+1]||Object.hasOwn(options,rest[i]))throw Error('Use --input FILE, --output DIRECTORY, optional --as-of ISO and --workers for batch');options[rest[i]]=rest[i+1];}
 if(!['catalog','audit','research','diagnose','risk','batch'].includes(command))throw Error('Commands: catalog | audit | research | diagnose | risk | batch');
 if(options['--workers']&&command!=='batch')throw Error('--workers applies only to batch');
 const input=options['--input']?await readJson(path.resolve(options['--input'])):null;
 const asOf=options['--as-of']?Date.parse(options['--as-of']):Date.now();if(!Number.isSafeInteger(asOf))throw Error('Invalid --as-of timestamp');
 let report;
 if(command==='catalog')report=intelligenceCatalog();
 else if(command==='audit')report=await loadEvidenceAudit();
 else if(command==='research'){
  if(!input)throw Error('research requires --input normalized 15m dataset JSON');
  report=researchIntelligence(input,{asOf});
 }else if(command==='batch'){
  if(!input||!Array.isArray(input.datasets))throw Error('batch requires a JSON object with datasets');
  report=await runResearchBatch(input.datasets,{asOf,workers:options['--workers']?Number(options['--workers']):2});
 }else if(command==='risk'){
  if(!input)throw Error('risk requires positions, returns, equity and optional candidates/settings');
  report={kind:'intelligence-portfolio-risk',portfolio:portfolioRisk(input.positions??[],input.returns,{...input.settings,equity:input.equity}),allocation:allocateResearchRisk(input.candidates??[],input.returns,input.allocationSettings)};
 }else{
  if(!input)throw Error('diagnose requires reference, current, calibration and optional history/features');
  if((input.calibration??[]).some(row=>row.timeMs>=asOf))throw Error('Calibration outcomes must be completed strictly before --as-of');
  const regimes=fitRegimes(input.reference??[]),calibration=calibratePredictionSets(input.calibration??[]);
  report={kind:'intelligence-model-diagnostics',regimes,regime:input.features?inferRegime(input.features,regimes):null,drift:distributionDrift(input.reference??[],input.current??[]),uncertainty:calibration,prediction:input.probability!=null?predictionSet(input.probability,calibration):null,ensemble:adaptiveEnsemble(input.history??[],{asOf}),researchOnly:true};
 }
 const artifact=options['--output']?await saveIntelligenceExperiment(options['--output'],report,{command,inputSha256:input?digest(JSON.stringify(input)):null,...(options['--as-of']?{asOf}:{} )}):null;
 return artifact?{artifact,report}:report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const output=await runIntelligence(process.argv.slice(2));console.log(JSON.stringify(output,null,2));if((output.report??output).kind==='intelligence-batch'&&(output.report??output).failed>0)process.exitCode=2;}catch(error){console.error(error.message);process.exitCode=1;}
}
