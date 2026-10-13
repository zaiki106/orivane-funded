import {fitRegularizedQDA} from './regularized-qda.mjs';
export const ldaAlgorithm='regularized-lda';
const vector=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
function factor(matrix){
  const n=matrix.length,l=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let x=matrix[i][j];for(let k=0;k<j;k++)x-=l[i][k]*l[j][k];
    if(i===j){if(!Number.isFinite(x)||x<=0)return null;l[i][j]=Math.sqrt(x);}else l[i][j]=x/l[j][j];
  }
  return l;
}
// Population within-class covariance, pooled by training class counts.
// Shrinkage targets the diagonal; ridge is included exactly once in the pool.
export function fitRegularizedLDA(rows,scaler,options={}){
  const q=fitRegularizedQDA(rows,scaler,options);if(!q)return null;
  const covariance=Array.from({length:q.dimension},(_,i)=>Array.from({length:q.dimension},(_,j)=>q.classes.reduce((sum,c,k)=>sum+q.classPrior[k]*c.covariance[i][j],0)));
  const cholesky=factor(covariance);if(!cholesky)return null;
  return {algorithm:ldaAlgorithm,dimension:q.dimension,shrinkage:q.shrinkage,ridge:q.ridge,clip:5,covarianceNormalization:'pooled-class-count',classPrior:q.classPrior,means:q.classes.map(c=>c.mean),counts:q.classes.map(c=>c.count),covariance,cholesky};
}
export function validLinearDiscriminant(model,n){
  if(model?.algorithm!==ldaAlgorithm||model.dimension!==n||model.clip!==5||model.covarianceNormalization!=='pooled-class-count'||!Number.isFinite(model.shrinkage)||model.shrinkage<0||model.shrinkage>1||!Number.isFinite(model.ridge)||model.ridge<=0||!vector(model.classPrior,3)||model.classPrior.some(p=>p<=0)||Math.abs(model.classPrior.reduce((a,b)=>a+b,0)-1)>1e-9||!Array.isArray(model.means)||model.means.length!==3||!model.means.every(m=>vector(m,n))||!vector(model.counts,3)||model.counts.some(x=>!Number.isSafeInteger(x)||x<1))return false;
  const total=model.counts.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total)||model.classPrior.some((p,k)=>Math.abs(p-model.counts[k]/total)>1e-9))return false;
  if(!Array.isArray(model.covariance)||model.covariance.length!==n||!Array.isArray(model.cholesky)||model.cholesky.length!==n)return false;
  for(let i=0;i<n;i++){
    if(!vector(model.covariance[i],n)||!vector(model.cholesky[i],n)||model.cholesky[i][i]<=0)return false;
    for(let j=0;j<n;j++){
      if(j>i&&model.cholesky[i][j]!==0)return false;
      const reconstructed=model.cholesky[i].reduce((sum,x,k)=>sum+x*model.cholesky[j]?.[k],0);
      if(Math.abs(reconstructed-model.covariance[i][j])>1e-8*Math.max(1,Math.abs(model.covariance[i][j])))return false;
    }
  }
  return true;
}
export function predictRegularizedLDA(features,model,scaler,{temperature=1}={}){
  const n=model?.dimension;
  if(!Number.isSafeInteger(n)||n<1||!validLinearDiscriminant(model,n)||!vector(features,n)||!vector(scaler?.mean,n)||!vector(scaler?.scale,n)||scaler.scale.some(x=>x<=0)||!Number.isFinite(temperature)||temperature<=0)return null;
  const point=features.map((x,j)=>Math.max(-5,Math.min(5,(x-scaler.mean[j])/scaler.scale[j])));
  const logits=model.means.map((mean,k)=>{
    const whitened=[];for(let i=0;i<n;i++){let x=point[i]-mean[i];for(let j=0;j<i;j++)x-=model.cholesky[i][j]*whitened[j];whitened[i]=x/model.cholesky[i][i];}
    return (-.5*whitened.reduce((sum,x)=>sum+x*x,0)+Math.log(model.classPrior[k]))/temperature;
  });
  const max=Math.max(...logits),exp=logits.map(x=>Math.exp(x-max)),sum=exp.reduce((a,b)=>a+b,0);
  return exp.map(x=>x/sum);
}
