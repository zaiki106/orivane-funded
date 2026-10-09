// Gaussian quadratic discrimination with class-specific full covariance.
// Diagonal-target shrinkage and a strictly positive ridge keep singular feature
// sets usable. The caller supplies a standardizer fitted on training only.
export const qdaAlgorithm='regularized-qda';
const labels=['UP','DOWN','FLAT'];
const finiteVector=(values,n)=>Array.isArray(values)&&values.length===n&&values.every(Number.isFinite);
const validScaler=scaler=>Array.isArray(scaler?.mean)&&scaler.mean.length>0&&finiteVector(scaler.mean,scaler.mean.length)&&finiteVector(scaler.scale,scaler.mean.length)&&scaler.scale.every(value=>value>0);
const transform=(features,scaler)=>features.map((value,j)=>Math.max(-5,Math.min(5,(value-scaler.mean[j])/scaler.scale[j])));

function cholesky(matrix){
  const n=matrix.length,factor=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let residual=matrix[i][j];for(let k=0;k<j;k++)residual-=factor[i][k]*factor[j][k];
    if(i===j){if(!Number.isFinite(residual)||residual<=0)return null;factor[i][j]=Math.sqrt(residual);}
    else factor[i][j]=residual/factor[j][j];
  }
  return factor;
}

export function fitRegularizedQDA(rows,scaler,{shrinkage=.25,ridge=.001}={}){
  if(!validScaler(scaler)||!Array.isArray(rows)||!rows.length||!Number.isFinite(shrinkage)||shrinkage<0||shrinkage>1||!Number.isFinite(ridge)||ridge<=0)return null;
  const dimension=scaler.mean.length;
  if(rows.some(row=>!finiteVector(row.features,dimension)||!labels.includes(row.label)))return null;
  const classes=[];
  for(const label of labels){
    const samples=rows.filter(row=>row.label===label).map(row=>transform(row.features,scaler));if(!samples.length)return null;
    const mean=Array.from({length:dimension},(_,j)=>samples.reduce((sum,row)=>sum+row[j],0)/samples.length),covariance=Array.from({length:dimension},()=>Array(dimension).fill(0));
    for(const sample of samples)for(let i=0;i<dimension;i++)for(let j=0;j<=i;j++)covariance[i][j]+=(sample[i]-mean[i])*(sample[j]-mean[j]);
    for(let i=0;i<dimension;i++)for(let j=0;j<=i;j++){
      const value=covariance[i][j]/samples.length*(i===j?1:1-shrinkage)+(i===j?ridge:0);
      covariance[i][j]=value;covariance[j][i]=value;
    }
    const factor=cholesky(covariance);if(!factor)return null;
    const logDeterminant=2*factor.reduce((sum,row,i)=>sum+Math.log(row[i]),0);
    classes.push({label,count:samples.length,mean,covariance,cholesky:factor,logDeterminant});
  }
  return {algorithm:qdaAlgorithm,dimension,shrinkage,ridge,clip:5,covarianceNormalization:'class-count',classPrior:classes.map(group=>group.count/rows.length),classes};
}

export function validDiscriminantModel(model,dimension){
  if(model?.algorithm!==qdaAlgorithm||model.dimension!==dimension||model.clip!==5||model.covarianceNormalization!=='class-count'||!Number.isFinite(model.shrinkage)||model.shrinkage<0||model.shrinkage>1||!Number.isFinite(model.ridge)||model.ridge<=0||!finiteVector(model.classPrior,3)||model.classPrior.some(value=>value<=0)||Math.abs(model.classPrior.reduce((a,b)=>a+b,0)-1)>1e-9||!Array.isArray(model.classes)||model.classes.length!==3)return false;
  return model.classes.every((group,k)=>{
    if(group.label!==labels[k]||!Number.isInteger(group.count)||group.count<1||!finiteVector(group.mean,dimension)||!Array.isArray(group.covariance)||group.covariance.length!==dimension||!Array.isArray(group.cholesky)||group.cholesky.length!==dimension||!Number.isFinite(group.logDeterminant))return false;
    for(let i=0;i<dimension;i++){
      if(!finiteVector(group.covariance[i],dimension)||!finiteVector(group.cholesky[i],dimension)||group.cholesky[i][i]<=0)return false;
      for(let j=0;j<dimension;j++)if(group.covariance[i][j]!==group.covariance[j]?.[i]||(j>i&&group.cholesky[i][j]!==0))return false;
    }
    const logDeterminant=2*group.cholesky.reduce((sum,row,i)=>sum+Math.log(row[i]),0);
    return Math.abs(logDeterminant-group.logDeterminant)<=1e-9*Math.max(1,Math.abs(logDeterminant));
  });
}

export function predictRegularizedQDA(features,model,scaler,{temperature=1}={}){
  if(!validScaler(scaler)||!finiteVector(features,scaler.mean.length)||!validDiscriminantModel(model,scaler.mean.length)||!Number.isFinite(temperature)||temperature<=0)return null;
  const point=transform(features,scaler),logits=model.classes.map((group,k)=>{
    const solved=[];let squaredDistance=0;
    for(let i=0;i<point.length;i++){
      let residual=point[i]-group.mean[i];for(let j=0;j<i;j++)residual-=group.cholesky[i][j]*solved[j];
      solved[i]=residual/group.cholesky[i][i];squaredDistance+=solved[i]**2;
    }
    return (Math.log(model.classPrior[k])-.5*(point.length*Math.log(2*Math.PI)+group.logDeterminant+squaredDistance))/temperature;
  });
  if(logits.some(value=>!Number.isFinite(value)))return null;
  const largest=Math.max(...logits),density=logits.map(value=>Math.exp(value-largest)),total=density.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(total)||total<=0)return null;
  return density.map(value=>value/total);
}
