// Original bounded multinomial gradient boosting implementation.
// Fixed shrinkage and train-only split thresholds; no strategy votes or test fitting.
export const boostingAlgorithm='gradient-boosted-stumps';
const classes=['UP','DOWN','FLAT'],finite=Number.isFinite;
const softmax=logits=>{const max=Math.max(...logits),e=logits.map(v=>Math.exp(v-max)),total=e.reduce((s,v)=>s+v,0);return e.map(v=>v/total);};
const validScaler=s=>Array.isArray(s?.mean)&&s.mean.length>0&&s.mean.every(finite)&&Array.isArray(s.scale)&&s.scale.length===s.mean.length&&s.scale.every(v=>finite(v)&&v>0);
const transform=(x,s)=>x.map((v,j)=>Math.max(-5,Math.min(5,(v-s.mean[j])/s.scale[j])));
export function fitBoostedStumps(rows,scaler,{rounds=32,learningRate=.08,minLeaf=12,l2=1}={}){
 if(!validScaler(scaler)||!Array.isArray(rows)||rows.length<2*minLeaf||!Number.isInteger(rounds)||rounds<1||rounds>64||!finite(learningRate)||learningRate<=0||learningRate>1||!Number.isInteger(minLeaf)||minLeaf<2||!finite(l2)||l2<=0)return null;
 const d=scaler.mean.length;if(rows.some(r=>!Array.isArray(r.features)||r.features.length!==d||r.features.some(v=>!finite(v))||!classes.includes(r.label)))return null;
 const n=rows.length,counts=classes.map(label=>rows.filter(r=>r.label===label).length);if(counts.some(v=>v===0))return null;
 const prior=counts.map(v=>v/n),base=prior.map(Math.log),samples=rows.map(r=>({x:transform(r.features,scaler),y:classes.indexOf(r.label)})),logits=samples.map(()=>[...base]);
 const splits=[];
 for(let j=0;j<d;j++){const ordered=samples.map((r,i)=>({v:r.x[j],i})).sort((a,b)=>a.v-b.v),used=new Set();for(let q=1;q<=7;q++){let at=Math.floor(n*q/8);while(at<n&&at>0&&ordered[at].v===ordered[at-1].v)at++;if(at<minLeaf||n-at<minLeaf||used.has(at))continue;used.add(at);splits.push({feature:j,threshold:(ordered[at-1].v+ordered[at].v)/2,leftIndices:ordered.slice(0,at).map(r=>r.i)});}}
 const trees=[];
 for(let round=0;round<rounds;round++){
  const p=logits.map(softmax);
  for(let k=0;k<3;k++){
   const g=samples.map((r,i)=>(r.y===k?1:0)-p[i][k]),h=p.map(v=>Math.max(1e-8,v[k]*(1-v[k]))),G=g.reduce((s,v)=>s+v,0),H=h.reduce((s,v)=>s+v,0);
   let best={feature:-1,threshold:0,left:G/(H+l2),right:G/(H+l2)},gain=G*G/(H+l2);
   for(const split of splits){let gl=0,hl=0;for(const i of split.leftIndices){gl+=g[i];hl+=h[i];}const gr=G-gl,hr=H-hl,score=gl*gl/(hl+l2)+gr*gr/(hr+l2);if(score>gain+1e-12){gain=score;best={feature:split.feature,threshold:split.threshold,left:gl/(hl+l2),right:gr/(hr+l2)};}}
   best.left=learningRate*Math.max(-2,Math.min(2,best.left));best.right=learningRate*Math.max(-2,Math.min(2,best.right));
   const tree={...best,classIndex:k,round};trees.push(tree);
   for(let i=0;i<n;i++)logits[i][k]+=tree.feature<0||samples[i].x[tree.feature]<=tree.threshold?tree.left:tree.right;
  }
 }
 return {algorithm:boostingAlgorithm,dimension:d,rounds,learningRate,minLeaf,l2,base,trees,trainingSample:n,classPrior:prior};
}
export function validBoostedModel(m,dimension){return m?.algorithm===boostingAlgorithm&&m.dimension===dimension&&Number.isInteger(m.rounds)&&m.rounds>=1&&m.rounds<=64&&Array.isArray(m.base)&&m.base.length===3&&m.base.every(finite)&&Array.isArray(m.trees)&&m.trees.length===m.rounds*3&&m.trees.every((t,i)=>Number.isInteger(t.feature)&&t.feature>=-1&&t.feature<dimension&&[t.threshold,t.left,t.right].every(finite)&&t.classIndex===i%3&&t.round===Math.floor(i/3));}
export function predictBoostedStumps(features,model,scaler,{temperature=1}={}){
 if(!validScaler(scaler)||!Array.isArray(features)||features.length!==scaler.mean.length||features.some(v=>!finite(v))||!validBoostedModel(model,scaler.mean.length)||!finite(temperature)||temperature<=0)return null;
 const x=transform(features,scaler),logits=[...model.base];for(const t of model.trees)logits[t.classIndex]+=t.feature<0||x[t.feature]<=t.threshold?t.left:t.right;
 return softmax(logits.map(v=>v/temperature));
}
