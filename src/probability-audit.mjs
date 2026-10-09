const labels=['UP','DOWN','FLAT'];
const probability=p=>Array.isArray(p)&&p.length===3&&p.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-9;
function score(rows,prior){
  let brier=0,baseline=0,directional=0,correct=0;
  for(const row of rows){const actual=labels.indexOf(row.label);for(let k=0;k<3;k++){brier+=(row.probabilities[k]-(k===actual?1:0))**2;baseline+=(prior[k]-(k===actual?1:0))**2;}
    const predicted=row.probabilities.indexOf(Math.max(...row.probabilities));
    if(predicted<2&&row.probabilities[predicted]>.6){directional++;if(predicted===actual)correct++;}
  }
  return {sample:rows.length,from:rows[0]?.time??null,to:rows.at(-1)?.labelEndTime??null,brier:rows.length?brier/rows.length:null,baselineBrier:rows.length?baseline/rows.length:null,brierSkill:baseline>0?1-brier/baseline:null,directionalAbove60:{sample:directional,correct,observedFrequency:directional?correct/directional:null,kind:'market-direction-not-trade-win-rate'}};
}
// Diagnostic only. No fitting, ranking or publication thresholds are changed.
export function auditProbabilityRows(rows,prior){
  if(!Array.isArray(rows)||!probability(prior)||rows.some((r,i)=>!labels.includes(r.label)||!probability(r.probabilities)||!Number.isSafeInteger(r.index)||!Number.isSafeInteger(r.labelEndIndex)||r.labelEndIndex<=r.index||!Number.isFinite(Date.parse(r.time))||!Number.isFinite(Date.parse(r.labelEndTime))||Date.parse(r.labelEndTime)<=Date.parse(r.time)||(i&&(r.index<=rows[i-1].index||Date.parse(r.time)<=Date.parse(rows[i-1].time)))))return {status:'unavailable',reason:'Observations du test invalides'};
  const disjoint=[];let end=-1;for(const row of rows)if(row.index>=end){disjoint.push(row);end=row.labelEndIndex;}
  return {status:rows.length?'available':'unavailable',kind:'frozen-model-chronological-diagnostic',usesTrainPrior:true,doesNotSelectModel:true,
    segments:Array.from({length:3},(_,i)=>({...score(rows.slice(Math.floor(rows.length*i/3),Math.floor(rows.length*(i+1)/3)),prior),part:i+1})),nonOverlapping:{...score(disjoint,prior),overlapRemoved:true,independenceAssumed:false}};
}
