import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {indicators,signal,analysisWindow} from './engine.mjs';
import {higherTimeframe} from './decision.mjs';
import {strategyRegistry,strategyDataReady,strategyRegistryVersion} from './strategy-registry.mjs';
import {researchCandidates,researchContext,researchSignal,researchCandidateVersion} from './research-candidates.mjs';
import {costForSymbol} from './cost-policy.mjs';
import {makeTradePlan,labelTradeOutcome,tradeEntryPolicy,tradeMaxEntryDelayMs} from './trade-outcome.mjs';

export async function exportStrategyLab(input,output,{endIndex=Infinity,onProgress=()=>{}}={}){
 if(resolve(input)===resolve(output))throw Error('Source and destination must differ');
 const source=await readFile(input),data=JSON.parse(source),bars=data.bars?.filter(b=>b.closed!==false);
 if(!bars||data.timeframe!==15||!data.source||!data.symbol||bars.length<240||bars.some((b,i)=>!Number.isFinite(Date.parse(b.time))||Date.parse(b.time)%900000!==0||![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||i&&Date.parse(b.time)<=Date.parse(bars[i-1].time)))throw Error('Invalid actual 15m source');
 // Research is confined to the original development half. Calibration and final
 // test bars are neither scanned nor used to settle trades across this boundary.
 const developmentEnd=Math.floor(bars.length*.5),limit=Math.min(endIndex,developmentEnd),baseCost=costForSymbol(data.symbol,{profile:'the5ers'}),rules=[...strategyRegistry,...researchCandidates],counts=Object.fromEntries(rules.map(r=>[r.id,{setups:0,history:0,noSetup:0,invalidPlans:0}]));
 await mkdir(dirname(output),{recursive:true});const partial=output+'.partial',stream=createWriteStream(partial,{flags:'wx'}),hash=createHash('sha256');let bytes=0,events=0,error=null;
 stream.on('error',e=>{error=e;});
 try{
  for(let i=240;i<limit;i++){
   const history=bars.slice(i-240,i),prefix=history.slice(-analysisWindow),q=indicators(prefix),h1=higherTimeframe(history),context=researchContext(history,q),entryTimeMs=Date.parse(bars[i].time);
   if(Date.parse(history.at(-1).time)+900000!==entryTimeMs)continue;
   for(const rule of rules){
    const stats=counts[rule.id],extra=rule.version===researchCandidateVersion;
    if(extra?!context:!strategyDataReady(rule,prefix).ready){stats.history++;continue;}
    const raw=extra?researchSignal(context,rule.id):signal(prefix,rule.id,q);
    if(raw.side==='HOLD'){stats.noSetup++;continue;}stats.setups++;
    const h1Aligned=!h1.available||!(raw.side==='BUY'&&h1.direction==='DOWN'||raw.side==='SELL'&&h1.direction==='UP');
    for(const multiplier of [1,1.5,2]){
     const cost={...baseCost,feeBps:baseCost.feeBps*multiplier,slippageBps:baseCost.slippageBps*multiplier,feePerUnit:(baseCost.feePerUnit??0)*multiplier};
     const plan=makeTradePlan(raw,{price:bars[i].open},cost,{entryTime:entryTimeMs,maxBars:16});
     if(!plan.valid){stats.invalidPlans++;continue;}
     const outcome=labelTradeOutcome(plan,bars.slice(i,Math.min(limit,i+16)),{mode:'ohlc'});
     const row={strategy:rule.id,family:rule.family,side:raw.side,costMultiplier:multiplier,h1Aligned,entryTimeMs,labelEndTimeMs:outcome.labelEndTimeMs??null,y:outcome.y,censored:outcome.censored,status:outcome.status,netR:outcome.netR??null};
     const text=JSON.stringify(row)+'\n';bytes+=Buffer.byteLength(text);if(bytes>1_000_000_000)throw Error('Research export exceeds 1 GB cap; partial preserved');
     hash.update(text);if(error)throw error;if(!stream.write(text))await once(stream,'drain');events++;
    }
   }
   if(i%5000===0)onProgress({bars:i,total:limit,events,bytes});
  }
  stream.end();await once(stream,'finish');if(error)throw error;await rename(partial,output);
 }catch(e){stream.destroy();throw e;}
 const manifest={schemaVersion:1,kind:'independent-strategy-development-events',status:'complete',symbol:data.symbol,source:data.source,synthetic:data.synthetic===true||data.provenance?.syntheticTestOnly===true||data.quality?.synthetic===true,sourceSha256:createHash('sha256').update(source).digest('hex'),eventsSha256:hash.digest('hex'),bytes,events,entryPolicy:tradeEntryPolicy,maxEntryDelayMs:tradeMaxEntryDelayMs,maxBars:16,registryVersion:strategyRegistryVersion,researchCandidateVersion,baseCost,costMultipliers:[1,1.5,2],fromMs:Date.parse(bars[240].time),throughMs:Date.parse(bars[limit-1].time)+900000,developmentBoundaryMs:Date.parse(bars[developmentEnd].time),usesFinalTest:false,paperPromotion:false,rules:rules.map(r=>({id:r.id,name:r.name,family:r.family,version:r.version,parameters:r.parameters})),counts};
 await writeFile(output+'.manifest.json',JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node src/export-strategy-lab.mjs DATA.json EVENTS.ndjson');
 const result=await exportStrategyLab(input,output,{onProgress:x=>process.stdout.write(JSON.stringify(x)+'\n')});console.log(JSON.stringify({events:result.events,bytes:result.bytes,strategies:result.rules.length,usesFinalTest:false}));
}
