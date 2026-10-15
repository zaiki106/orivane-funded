// Compact supervised research models. Artifacts never authorize paper/live signals.
export const researchLearnerVersion='orivane-binary-research-v1';
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const vector=(x,n)=>Array.isArray(x)&&x.length===n&&Array.from({length:n},(_,i)=>x[i]).every(Number.isFinite);
function trainingRows(rows){
 if(!Array.isArray(rows)||rows.length>20000||Array.from(rows).some(r=>!r))throw Error('At most 20000 dense supervised research rows are supported');
 const width=rows[0]?.features?.length;
 if(!Number.isInteger(width)||width<1||width>128||rows.some(r=>!vector(r.features,width)||![0,1].includes(r.y)))throw Error('Invalid supervised research features/labels');
 return width;
}
const standardized=(features,scaler)=>features.map((v,j)=>Math.max(-12,Math.min(12,(v-scaler.mean[j])/scaler.scale[j])));
export function fitResearchClassifier(rows,{l2=.1,iterations=160,learningRate=.15}={}){
 const dimension=trainingRows(rows);
 if(!Number.isFinite(l2)||l2<0||l2>100||!Number.isInteger(iterations)||iterations<1||iterations>1000||!Number.isFinite(learningRate)||learningRate<=0||learningRate>1)throw Error('Invalid classifier hyperparameters');
 if(rows.length<20||new Set(rows.map(r=>r.y)).size<2)return {status:'insufficient',reason:'twenty-training-rows-and-two-outcomes-required',samples:rows.length};
 const mean=Array.from({length:dimension},(_,j)=>rows.reduce((s,r)=>s+r.features[j],0)/rows.length);
 const scale=mean.map((m,j)=>Math.sqrt(rows.reduce((s,r)=>s+(r.features[j]-m)**2,0)/rows.length)||1);
 if(![...mean,...scale].every(Number.isFinite))throw Error('Feature scaling exceeds numeric limits');
 const scaler={mean,scale},x=rows.map(r=>standardized(r.features,scaler)),weights=Array(dimension).fill(0);
 // Logistic Hessian <= .25 * E[augmented_x * augmented_x^T] + l2.
 // A conservative trace bound keeps every accepted regularization stable.
 const maxNorm=x.reduce((maximum,row)=>Math.max(maximum,1+row.reduce((sum,v)=>sum+v*v,0)),1);
 const effectiveLearningRate=Math.min(learningRate,1/(l2+.25*maxNorm));
 const prior=rows.reduce((s,r)=>s+r.y,0)/rows.length;let intercept=Math.log(prior/(1-prior));
 for(let iteration=0;iteration<iterations;iteration++){
  const gradient=Array(dimension).fill(0);let bias=0;
  for(let i=0;i<rows.length;i++){const residual=sigmoid(intercept+x[i].reduce((s,v,j)=>s+v*weights[j],0))-rows[i].y;bias+=residual;for(let j=0;j<dimension;j++)gradient[j]+=residual*x[i][j];}
  const step=effectiveLearningRate/Math.sqrt(1+iteration/25);intercept-=step*bias/rows.length;
  for(let j=0;j<dimension;j++)weights[j]-=step*(gradient[j]/rows.length+l2*weights[j]);
 }
 if(!weights.every(Number.isFinite)||!Number.isFinite(intercept))throw Error('Research optimization did not remain finite');
 return {status:'fitted',algorithm:'standardized-binary-logistic',version:researchLearnerVersion,dimension,samples:rows.length,scaler,weights,intercept,l2,iterations,learningRate,effectiveLearningRate,prior,researchOnly:true};
}
export function predictResearchClassifier(features,model){
 if(model?.status!=='fitted')return null;
 if(model.algorithm!=='standardized-binary-logistic'||!Number.isInteger(model.dimension)||!vector(features,model.dimension)||!vector(model.weights,model.dimension)||!vector(model.scaler?.mean,model.dimension)||!vector(model.scaler?.scale,model.dimension)||model.scaler.scale.some(v=>v<=0)||!Number.isFinite(model.intercept))throw Error('Invalid research predictor');
 const x=standardized(features,model.scaler),margin=model.intercept+x.reduce((s,v,j)=>s+v*model.weights[j],0);
 if(!Number.isFinite(margin))throw Error('Research prediction exceeds numeric limits');return sigmoid(margin);
}
export function fitRegimeOutcomeModel(rows,{strength=10}={}){
 if(!Array.isArray(rows)||rows.length>20000||rows.some(r=>typeof r.strategy!=='string'||!r.strategy||!Number.isInteger(r.regime)||r.regime<0||![0,1].includes(r.y))||!Number.isFinite(strength)||strength<=0)throw Error('Invalid strategy/regime observations');
 if(rows.length<20||new Set(rows.map(r=>r.y)).size<2)return {status:'insufficient',samples:rows.length,reason:'twenty-training-rows-and-two-outcomes-required'};
 const prior=rows.reduce((s,r)=>s+r.y,0)/rows.length,cells=new Map();
 for(const row of rows){const key=JSON.stringify([row.strategy,row.regime]),cell=cells.get(key)??{strategy:row.strategy,regime:row.regime,samples:0,wins:0};cell.samples++;cell.wins+=row.y;cells.set(key,cell);}
 return {status:'fitted',algorithm:'strategy-regime-beta-shrinkage',version:researchLearnerVersion,prior,strength,samples:rows.length,cells:[...cells.values()],researchOnly:true};
}
export function predictRegimeOutcome(strategy,regime,model){
 if(model?.status!=='fitted')return null;
 if(typeof strategy!=='string'||!Number.isInteger(regime)||regime<0||model.algorithm!=='strategy-regime-beta-shrinkage'||!Number.isFinite(model.prior)||model.prior<0||model.prior>1||!Number.isFinite(model.strength)||model.strength<=0||!Array.isArray(model.cells)||model.cells.some(c=>typeof c.strategy!=='string'||!Number.isInteger(c.regime)||c.regime<0||!Number.isSafeInteger(c.samples)||c.samples<1||!Number.isSafeInteger(c.wins)||c.wins<0||c.wins>c.samples))throw Error('Invalid regime outcome predictor');
 const cell=model.cells.find(c=>c.strategy===strategy&&c.regime===regime);
 return cell?(cell.wins+model.strength*model.prior)/(cell.samples+model.strength):model.prior;
}
export function probabilityMetrics(rows,probabilities,{bins=10}={}){
 if(!Array.isArray(rows)||!Array.isArray(probabilities)||rows.length!==probabilities.length||Array.from(rows).some(r=>!r||![0,1].includes(r.y))||Array.from(probabilities).some(p=>!Number.isFinite(p)||p<0||p>1)||!Number.isInteger(bins)||bins<2||bins>50)throw Error('Invalid probability evaluation');
 if(!rows.length)return {status:'insufficient',samples:0,brier:null,logLoss:null,ece:null,reliability:[]};
 const reliability=Array.from({length:bins},(_,index)=>({lower:index/bins,upper:(index+1)/bins,samples:0,predictedSum:0,positive:0}));
 let brier=0,logLoss=0;
 for(let i=0;i<rows.length;i++){const p=probabilities[i],y=rows[i].y,cell=reliability[Math.min(bins-1,Math.floor(p*bins))];cell.samples++;cell.predictedSum+=p;cell.positive+=y;brier+=(p-y)**2;const safe=Math.max(1e-15,Math.min(1-1e-15,p));logLoss-=y*Math.log(safe)+(1-y)*Math.log(1-safe);}
 let ece=0;const cells=reliability.map(c=>{const predicted=c.samples?c.predictedSum/c.samples:null,observed=c.samples?c.positive/c.samples:null;if(c.samples)ece+=c.samples/rows.length*Math.abs(predicted-observed);return {lower:c.lower,upper:c.upper,samples:c.samples,predicted,observed};});
 return {status:'measured',samples:rows.length,brier:brier/rows.length,logLoss:logLoss/rows.length,ece,reliability:cells};
}
