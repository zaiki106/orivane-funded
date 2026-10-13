import {walkForwardResearch} from './core/research-lab.mjs';
import {calibrateDecision} from './core/decision.mjs';
import {laboratory} from './core/engine.mjs';
import {replayDecisions} from './core/decision-replay.mjs';
import {costForSymbol} from './core/cost-policy.mjs';
globalThis.process={env:{ORIVANE_COST_PROFILE:'the5ers'}};
self.onmessage=({data:m})=>{
 if(m.type!=='model-request')return;
 const {symbol,version,dataset}=m;
 try{
  const model=calibrateDecision(dataset,{cost:costForSymbol(symbol),classCalibration:true,maxHistory:5000,boosting:true});
  postMessage({type:'model-fit',symbol,version,model});
  let lab=null,replay=null;
  try{lab=laboratory(dataset);lab.datasetVersion=version;lab.research=walkForwardResearch(dataset);replay=replayDecisions(dataset,model);replay.stress={costMultiplier:2,metrics:replayDecisions(dataset,model,{costMultiplier:2}).metrics};}catch{}
  postMessage({type:'model-complete',symbol,version,lab,replay});
 }catch{postMessage({type:'model-error',symbol,version});}
};
