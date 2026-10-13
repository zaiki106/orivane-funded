// A local nonlinear classifier, using only standardized training observations.
// Distances are Euclidean after train-only z scaling and clipping to [-5, 5].
// Weights are 1 / (1 + distance). Their mass is normalized to k observations,
// then three prior-weighted pseudo-observations smooth class probabilities.
export const neighborAlgorithm='weighted-knn';
export const neighborClasses=Object.freeze(['UP','DOWN','FLAT']);
export const neighborPolicy=Object.freeze({distance:'train-standardized-euclidean',weighting:'1/(1+distance)',smoothing:3,smoothingBasis:'training-class-prior',clipping:5});

const finiteVector=(values,length)=>Array.isArray(values)&&values.length===length&&values.every(Number.isFinite);
function validScaler(scaler){return Array.isArray(scaler?.mean)&&scaler.mean.length>0&&finiteVector(scaler.mean,scaler.mean.length)&&finiteVector(scaler.scale,scaler.mean.length)&&scaler.scale.every(x=>x>0);}
function standardized(features,scaler){return features.map((value,i)=>Math.max(-5,Math.min(5,(value-scaler.mean[i])/scaler.scale[i])));}

export function fitNearestNeighbors(rows,scaler,{k=31,smoothing=neighborPolicy.smoothing}={}){
  if(!Array.isArray(rows)||!validScaler(scaler)||!Number.isInteger(k)||k<1||rows.length<k||!Number.isFinite(smoothing)||smoothing<0)return null;
  const dimension=scaler.mean.length;
  if(rows.some(row=>!finiteVector(row.features,dimension)||!neighborClasses.includes(row.label)))return null;
  const distribution=neighborClasses.map(label=>rows.filter(row=>row.label===label).length);
  if(distribution.some(count=>count===0))return null;
  return {algorithm:neighborAlgorithm,dimension,k,...neighborPolicy,smoothing,
    classPrior:distribution.map(count=>count/rows.length),
    samples:rows.map((row,order)=>({index:row.index??order,time:row.time??null,labelEndIndex:row.labelEndIndex??row.index??order,labelEndTime:row.labelEndTime??null,label:row.label,classIndex:neighborClasses.indexOf(row.label),features:standardized(row.features,scaler)}))};
}

export function validNeighborModel(model,dimension){
  return model?.algorithm===neighborAlgorithm&&model.dimension===dimension&&Number.isInteger(model.k)&&model.k>=1&&Number.isFinite(model.smoothing)&&model.smoothing>=0&&
    finiteVector(model.classPrior,3)&&model.classPrior.every(x=>x>=0)&&Math.abs(model.classPrior.reduce((a,b)=>a+b,0)-1)<1e-9&&
    Array.isArray(model.samples)&&model.samples.length>=model.k&&model.samples.every(row=>finiteVector(row.features,dimension)&&Number.isInteger(row.classIndex)&&row.classIndex>=0&&row.classIndex<3&&row.label===neighborClasses[row.classIndex]);
}

export function predictNearestNeighbors(features,model,scaler,{excludeIndex=null}={}){
  if(!validScaler(scaler)||!finiteVector(features,scaler.mean.length)||!validNeighborModel(model,scaler.mean.length))return null;
  const point=standardized(features,scaler),distances=[];
  for(let order=0;order<model.samples.length;order++){
    const sample=model.samples[order];if(excludeIndex!==null&&sample.index===excludeIndex)continue;
    let squared=0;for(let i=0;i<point.length;i++)squared+=(point[i]-sample.features[i])**2;
    distances.push({sample,order,distance:Math.sqrt(squared)});
  }
  // A deterministic secondary key keeps equal-distance neighbors stable.
  distances.sort((a,b)=>a.distance-b.distance||a.order-b.order);
  const nearest=distances.slice(0,model.k);if(nearest.length<model.k)return null;
  const scores=[0,0,0];let totalWeight=0,squaredWeight=0;
  for(const row of nearest){row.weight=1/(1+row.distance);scores[row.sample.classIndex]+=row.weight;totalWeight+=row.weight;squaredWeight+=row.weight**2;}
  const probabilities=scores.map((value,i)=>(value/totalWeight*nearest.length+model.smoothing*model.classPrior[i])/(nearest.length+model.smoothing));
  return {probabilities,neighborsCount:nearest.length,effectiveNeighbors:totalWeight**2/squaredWeight,
    detail:nearest.slice(0,5).map(({sample,distance,weight})=>({time:sample.time,labelEndTime:sample.labelEndTime,label:sample.label,distance,weight:weight/totalWeight}))};
}
