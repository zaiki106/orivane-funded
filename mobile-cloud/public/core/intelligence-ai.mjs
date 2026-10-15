// Research diagnostics only: none of these outputs authorizes a trade or changes
// the terminal's official calibrated TP-before-SL probability.
const MAX_ROWS=50000,MAX_DIMENSION=128;
const caveat='Split-conformal marginal coverage requires exchangeable calibration and future observations; dependent market time series have no unconditional coverage guarantee.';
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function rowsShape(rows){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw new TypeError('Expected at most 50000 feature rows');
 const dimension=rows[0]?.length??0;
 if(rows.length&&(!Number.isInteger(dimension)||dimension<1||dimension>MAX_DIMENSION))throw new TypeError('Feature width must be 1..128');
 for(const row of rows)if(!Array.isArray(row)||row.length!==dimension||!Array.from(row).every(Number.isFinite))throw new TypeError('Feature vectors must have equal width and finite numeric values');
 return dimension;
}
function integer(value,min,max,name){if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`${name} must be an integer in ${min}..${max}`);}
function probability(value){if(!Number.isFinite(value)||value<0||value>1)throw new TypeError('Probability must be a finite number in [0,1]');return value;}
function time(value,name){if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`${name} must be a nonnegative integer timestamp`);return value;}
function distance(left,right){let result=0;for(let j=0;j<left.length;j++){const delta=left[j]-right[j];result+=delta*delta;}return result;}
function closest(point,centroids){let selected=0,best=Infinity;for(let i=0;i<centroids.length;i++){const current=distance(point,centroids[i]);if(current<best){selected=i;best=current;}}return [selected,best];}

// All standardization and centroid fitting use only the explicitly supplied
// training rows. Seeds use deterministic farthest-point selection, with input
// order breaking exact ties. Regime indices carry no bullish/bearish semantics.
export function fitRegimes(rows,{clusters=3,iterations=40}={}){
 const dimension=rowsShape(rows);integer(clusters,2,16,'clusters');integer(iterations,1,200,'iterations');
 const insufficient=reason=>freeze({status:'insufficient',reason,samples:rows.length,dimension});
 if(rows.length<Math.max(6,clusters*2))return insufficient('too_few_training_rows');
 const mean=[],scale=[];
 for(let j=0;j<dimension;j++){
  let magnitude=0;for(const row of rows)magnitude=Math.max(magnitude,Math.abs(row[j]));
  if(magnitude===0){mean.push(0);scale.push(1);continue;}
  let average=0,m2=0,n=0;
  for(const row of rows){const value=row[j]/magnitude,delta=value-average;average+=delta/++n;m2+=delta*(value-average);}
  mean.push(average*magnitude);scale.push(Math.sqrt(Math.max(0,m2/n))*magnitude||1);
 }
 const points=rows.map(row=>row.map((x,j)=>x/scale[j]-mean[j]/scale[j]));
 if(points.some(point=>!point.every(Number.isFinite)))return insufficient('numeric_range_not_supported');
 const origin=Array(dimension).fill(0);let first=0;
 for(let i=1;i<points.length;i++)if(distance(points[i],origin)>distance(points[first],origin))first=i;
 const centroids=[points[first].slice()];
 while(centroids.length<clusters){
  let next=0,best=-1;for(let i=0;i<points.length;i++){const gap=closest(points[i],centroids)[1];if(gap>best){best=gap;next=i;}}
  if(best<=0)return insufficient(centroids.length===1?'constant_features':'too_few_distinct_training_points');
  centroids.push(points[next].slice());
 }
 let counts=[],used=0,converged=false;
 for(;used<iterations;used++){
  counts=Array(clusters).fill(0);const sums=centroids.map(()=>Array(dimension).fill(0));
  for(const point of points){const [selected]=closest(point,centroids);counts[selected]++;for(let j=0;j<dimension;j++)sums[selected][j]+=point[j];}
  if(counts.some(count=>count===0))return insufficient('empty_cluster');
  let movement=0;
  for(let k=0;k<clusters;k++){const next=sums[k].map(value=>value/counts[k]);movement+=distance(next,centroids[k]);centroids[k]=next;}
  if(movement<=1e-20){converged=true;used++;break;}
 }
 counts=Array(clusters).fill(0);let inertia=0;
 for(const point of points){const [selected,gap]=closest(point,centroids);counts[selected]++;inertia+=gap;}
 if(counts.some(count=>count===0)||!Number.isFinite(inertia))return insufficient('degenerate_cluster_solution');
 return freeze({status:'fitted',algorithm:'standardized-kmeans-v1',dimension,samples:rows.length,clusters,
  iterations:used,converged,scaler:{mean,scale},centroids,counts,inertia});
}

export function inferRegime(features,model){
 if(!Array.isArray(features)||!features.length||features.length>MAX_DIMENSION||!Array.from(features).every(Number.isFinite))throw new TypeError('Expected a finite feature vector');
 if(model?.status==='insufficient')return freeze({status:'insufficient',reason:'regime_model_unavailable'});
 const width=model?.dimension,validVector=vector=>Array.isArray(vector)&&vector.length===width&&Array.from(vector).every(Number.isFinite);
 if(model?.status!=='fitted'||model.algorithm!=='standardized-kmeans-v1'||!Number.isInteger(width)||width<1||width>MAX_DIMENSION||
  features.length!==width||!validVector(model.scaler?.mean)||!validVector(model.scaler?.scale)||model.scaler.scale.some(value=>value<=0)||
  !Number.isInteger(model.clusters)||model.clusters<2||model.clusters>16||!Array.isArray(model.centroids)||model.centroids.length!==model.clusters||!Array.from(model.centroids).every(validVector))throw new TypeError('Invalid regime model or incompatible feature vector');
 const point=features.map((value,j)=>value/model.scaler.scale[j]-model.scaler.mean[j]/model.scaler.scale[j]);
 const distances=model.centroids.map(center=>Math.sqrt(distance(point,center)));
 if(!distances.every(Number.isFinite))return freeze({status:'insufficient',reason:'numeric_range_not_supported'});
 const regime=distances.indexOf(Math.min(...distances));
 return freeze({status:'estimated',regime,distances,nearestDistance:distances[regime]});
}

// Empirical quantile cuts are fitted on reference rows only. Separate finite
// underflow/overflow buckets detect shifts even when reference data is constant.
// PSI uses a Jeffreys 0.5 pseudo-count in every bucket; it is not a p-value or a
// causal explanation, and no arbitrary trading threshold is applied here.
export function distributionDrift(referenceRows,currentRows,{bins=10}={}){
 const dimension=rowsShape(referenceRows),currentDimension=rowsShape(currentRows);integer(bins,2,50,'bins');
 if(referenceRows.length&&currentRows.length&&dimension!==currentDimension)throw new TypeError('Drift windows must have equal feature width');
 const result={status:'insufficient',referenceSamples:referenceRows.length,currentSamples:currentRows.length,features:[],meanPsi:null,maxPsi:null,reasons:[]};
 if(referenceRows.length<20||currentRows.length<20){result.reasons.push('at_least_20_observations_per_window_required');return freeze(result);}
 for(let j=0;j<dimension;j++){
  const sorted=referenceRows.map(row=>row[j]).sort((a,b)=>a-b),min=sorted[0],max=sorted.at(-1),cuts=[];
  for(let i=1;i<bins;i++){const value=sorted[Math.ceil(i*sorted.length/bins)-1];if(value>min&&value<max&&value!==cuts.at(-1))cuts.push(value);}
  const bucketCount=cuts.length+3;
  const count=rows=>{const values=Array(bucketCount).fill(0);for(const row of rows){const x=row[j];let index=x<min?0:x>max?bucketCount-1:1;
   if(index===1)while(index<=cuts.length&&x>=cuts[index-1])index++;values[index]++;}return values;};
  const referenceCounts=count(referenceRows),currentCounts=count(currentRows);let psi=0;
  for(let i=0;i<bucketCount;i++){const p=(referenceCounts[i]+.5)/(referenceRows.length+.5*bucketCount),q=(currentCounts[i]+.5)/(currentRows.length+.5*bucketCount);psi+=(q-p)*Math.log(q/p);}
  result.features.push({index:j,psi,boundaries:min===max?[min]:[min,...cuts,max],bins:bucketCount,referenceCounts,currentCounts});
 }
 result.status='measured';result.meanPsi=result.features.reduce((sum,item)=>sum+item.psi,0)/dimension;result.maxPsi=Math.max(...result.features.map(item=>item.psi));
 result.reasons.push('descriptive_population_stability_index_not_a_significance_test');return freeze(result);
}

// Caller must supply a separate calibration split, untouched by model selection.
// Finite-sample rank is ceil((n+1)*(1-alpha)); when it exceeds n we do not silently
// clip the quantile or claim a confidence level unsupported by this sample.
export function calibratePredictionSets(rows,{alpha=.1}={}){
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw new TypeError('Expected at most 50000 calibration rows');
 if(!Number.isFinite(alpha)||alpha<=0||alpha>=1)throw new RangeError('alpha must be between 0 and 1');
 const scores=[];let through=null;
 for(const row of rows){probability(row?.probability);if(row.y!==0&&row.y!==1)throw new TypeError('Binary labels must be 0 or 1');time(row.timeMs,'timeMs');
  through=Math.max(through??0,row.timeMs);scores.push(row.y===1?1-row.probability:row.probability);}
 const rank=Math.ceil((rows.length+1)*(1-alpha));
 const result={status:'insufficient',algorithm:'binary-split-conformal-v1',samples:rows.length,alpha,rank,quantile:null,calibratedThroughMs:through,coverageCaveat:caveat};
 if(rows.length<20){result.reason='at_least_20_calibration_rows_required';return freeze(result);}
 if(rank>rows.length){result.reason='finite_sample_quantile_unavailable';return freeze(result);}
 scores.sort((a,b)=>a-b);result.status='calibrated';result.quantile=scores[rank-1];return freeze(result);
}

export function predictionSet(probabilities,calibration){
 let p;
 if(Array.isArray(probabilities)){
  if(probabilities.length!==2)throw new TypeError('Expected binary probability pair');probability(probabilities[0]);probability(probabilities[1]);
  if(Math.abs(probabilities[0]+probabilities[1]-1)>1e-12)throw new TypeError('Binary probability pair must sum to one');p=probabilities[1];
 }else p=probability(probabilities);
 if(calibration?.status==='insufficient')return freeze({status:'insufficient',labels:[0,1],quantile:null,reason:'calibration_unavailable',coverageCaveat:caveat});
 if(calibration?.status!=='calibrated'||calibration.algorithm!=='binary-split-conformal-v1'||!Number.isFinite(calibration.quantile)||calibration.quantile<0||calibration.quantile>1||
  !Number.isSafeInteger(calibration.samples)||calibration.samples<20||!Number.isFinite(calibration.alpha)||calibration.alpha<=0||calibration.alpha>=1||
  calibration.rank!==Math.ceil((calibration.samples+1)*(1-calibration.alpha))||calibration.rank>calibration.samples)throw new TypeError('Invalid conformal calibration');
 const labels=[];if(p<=calibration.quantile)labels.push(0);if(1-p<=calibration.quantile)labels.push(1);
 return freeze({status:'estimated',labels,quantile:calibration.quantile,coverageCaveat:caveat});
}

// Only labels strictly completed before asOf may influence weights. Half-life is
// measured in DISTINCT completed label timestamps, so equal-time models get equal
// recency. Inverse historical Brier weights use a 0.01 loss floor; these remain
// advisory weights, never a new calibrated trading probability.
export function adaptiveEnsemble(history,{asOf,halfLife=50}={}){
 if(!Array.isArray(history)||history.length>MAX_ROWS)throw new TypeError('Expected at most 50000 ensemble observations');time(asOf,'asOf');
 if(!Number.isFinite(halfLife)||halfLife<=0)throw new RangeError('halfLife must be positive');
 const completed=[];
 for(const row of history){
  if(typeof row?.model!=='string'||!row.model.trim()||row.model.length>128)throw new TypeError('Model must be a nonempty identifier of at most 128 characters');
  probability(row.probability);time(row.labelEndTimeMs,'labelEndTimeMs');if(row.y!==0&&row.y!==1)throw new TypeError('Binary labels must be 0 or 1');
  if(row.labelEndTimeMs<asOf)completed.push(row);
 }
 const times=[...new Set(completed.map(row=>row.labelEndTimeMs))].sort((a,b)=>b-a),ranks=new Map(times.map((stamp,index)=>[stamp,index])),groups=new Map();
 for(const row of completed){const record=groups.get(row.model)??{model:row.model,samples:0,weightedLoss:0,totalWeight:0};
  const weight=Math.exp(-Math.LN2*ranks.get(row.labelEndTimeMs)/halfLife);record.samples++;record.weightedLoss+=weight*(row.probability-row.y)**2;record.totalWeight+=weight;groups.set(row.model,record);}
 const models=[...groups.values()].filter(row=>row.samples>=5&&row.totalWeight>0).sort((a,b)=>a.model<b.model?-1:a.model>b.model?1:0).map(row=>({model:row.model,samples:row.samples,brier:row.weightedLoss/row.totalWeight,weight:0}));
 const sum=models.reduce((total,row)=>total+1/Math.max(.01,row.brier),0);
 for(const row of models)row.weight=(1/Math.max(.01,row.brier))/sum;
 const weights=Object.fromEntries(models.map(row=>[row.model,row.weight]));
 return freeze({status:models.length>=2?'weighted':'insufficient',asOf,halfLife,halfLifeUnit:'distinct_completed_label_times',
  completed:completed.length,excluded:history.length-completed.length,weights,models,
  reasons:[...(models.length<2?['at_least_two_models_with_five_completed_labels_required']:[]),
   ...(models.length<groups.size?['models_with_insufficient_completed_evidence_excluded']:[]),
   'historical_brier_weights_are_advisory_not_calibrated_confidence',
   'scores_can_cover_different_historical_windows']});
}
