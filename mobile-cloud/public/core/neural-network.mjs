// A deterministic, one-hidden-layer classifier. The caller provides a scaler
// fitted on training observations only. Full-batch Adam minimizes mean
// cross-entropy + (regularization / 2) * squared non-bias weights.
export const neuralAlgorithm='neural-network';
const labels=['UP','DOWN','FLAT'];
const finiteVector=(values,n)=>Array.isArray(values)&&values.length===n&&values.every(Number.isFinite);
const validScaler=scaler=>Array.isArray(scaler?.mean)&&scaler.mean.length>0&&scaler.mean.length<=128&&finiteVector(scaler.mean,scaler.mean.length)&&finiteVector(scaler.scale,scaler.mean.length)&&scaler.scale.every(value=>value>0);
const transform=(features,scaler)=>features.map((value,j)=>Math.max(-5,Math.min(5,(value-scaler.mean[j])/scaler.scale[j])));

function seededRandom(seed){
  let state=seed>>>0;
  return ()=>{let t=state+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}

export function fitNeuralNetwork(rows,scaler,{hiddenUnits=8,iterations=160,learningRate=.015,regularization=.01,seed=137799}={}){
  if(!validScaler(scaler)||!Array.isArray(rows)||!rows.length||rows.length>10000||!Number.isInteger(hiddenUnits)||hiddenUnits<1||hiddenUnits>64||!Number.isInteger(iterations)||iterations<1||iterations>500||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.1||!Number.isFinite(regularization)||regularization<0||regularization>10||!Number.isInteger(seed)||seed<0||seed>0xffffffff)return null;
  const dimension=scaler.mean.length;
  if(rows.some(row=>!finiteVector(row.features,dimension)||!labels.includes(row.label)))return null;
  const distribution=labels.map(label=>rows.filter(row=>row.label===label).length);if(distribution.some(count=>count===0))return null;
  const n=rows.length,classPrior=distribution.map(count=>count/n),samples=rows.map(row=>({features:transform(row.features,scaler),label:labels.indexOf(row.label)}));
  const hiddenBiasOffset=hiddenUnits*dimension,outputOffset=hiddenBiasOffset+hiddenUnits,outputBiasOffset=outputOffset+3*hiddenUnits;
  const parameters=new Float64Array(outputBiasOffset+3),firstMoment=new Float64Array(parameters.length),secondMoment=new Float64Array(parameters.length),gradient=new Float64Array(parameters.length),hidden=new Float64Array(hiddenUnits),probabilities=new Float64Array(3),random=seededRandom(seed);
  const hiddenBound=Math.sqrt(6/(dimension+hiddenUnits)),outputBound=Math.sqrt(6/(hiddenUnits+3));
  for(let i=0;i<hiddenBiasOffset;i++)parameters[i]=(2*random()-1)*hiddenBound;
  for(let i=outputOffset;i<outputBiasOffset;i++)parameters[i]=(2*random()-1)*outputBound;
  for(let k=0;k<3;k++)parameters[outputBiasOffset+k]=Math.log(classPrior[k]);
  let beta1Power=1,beta2Power=1;
  for(let iteration=0;iteration<iterations;iteration++){
    gradient.fill(0);
    for(const sample of samples){
      for(let h=0;h<hiddenUnits;h++){
        let value=parameters[hiddenBiasOffset+h];for(let j=0;j<dimension;j++)value+=parameters[h*dimension+j]*sample.features[j];hidden[h]=Math.tanh(value);
      }
      let largest=-Infinity;
      for(let k=0;k<3;k++){
        let value=parameters[outputBiasOffset+k];for(let h=0;h<hiddenUnits;h++)value+=parameters[outputOffset+k*hiddenUnits+h]*hidden[h];
        probabilities[k]=value;largest=Math.max(largest,value);
      }
      let total=0;for(let k=0;k<3;k++){probabilities[k]=Math.exp(probabilities[k]-largest);total+=probabilities[k];}
      for(let k=0;k<3;k++){
        probabilities[k]=probabilities[k]/total-(sample.label===k?1:0);gradient[outputBiasOffset+k]+=probabilities[k];
        for(let h=0;h<hiddenUnits;h++)gradient[outputOffset+k*hiddenUnits+h]+=probabilities[k]*hidden[h];
      }
      for(let h=0;h<hiddenUnits;h++){
        let delta=0;for(let k=0;k<3;k++)delta+=probabilities[k]*parameters[outputOffset+k*hiddenUnits+h];delta*=1-hidden[h]*hidden[h];
        gradient[hiddenBiasOffset+h]+=delta;
        for(let j=0;j<dimension;j++)gradient[h*dimension+j]+=delta*sample.features[j];
      }
    }
    beta1Power*=.9;beta2Power*=.999;
    for(let i=0;i<parameters.length;i++){
      const nonBias=i<hiddenBiasOffset||i>=outputOffset&&i<outputBiasOffset;
      const g=gradient[i]/n+(nonBias?regularization*parameters[i]:0);
      firstMoment[i]=.9*firstMoment[i]+.1*g;secondMoment[i]=.999*secondMoment[i]+.001*g*g;
      parameters[i]-=learningRate*(firstMoment[i]/(1-beta1Power))/(Math.sqrt(secondMoment[i]/(1-beta2Power))+1e-8);
      if(!Number.isFinite(parameters[i]))return null;
    }
  }
  return {algorithm:neuralAlgorithm,dimension,hiddenUnits,activation:'tanh',outputActivation:'softmax',clip:5,optimizer:'full-batch-adam',initialization:'seeded-xavier-uniform',objective:'mean-cross-entropy-plus-half-l2',iterations,learningRate,regularization,seed,trainingSamples:n,classPrior,
    hiddenWeights:Array.from({length:hiddenUnits},(_,h)=>Array.from(parameters.slice(h*dimension,(h+1)*dimension))),hiddenBias:Array.from(parameters.slice(hiddenBiasOffset,outputOffset)),
    outputWeights:Array.from({length:3},(_,k)=>Array.from(parameters.slice(outputOffset+k*hiddenUnits,outputOffset+(k+1)*hiddenUnits))),outputBias:Array.from(parameters.slice(outputBiasOffset))};
}

export function validNeuralModel(model,dimension){
  if(model?.algorithm!==neuralAlgorithm||model.dimension!==dimension||!Number.isInteger(dimension)||dimension<1||dimension>128||!Number.isInteger(model.hiddenUnits)||model.hiddenUnits<1||model.hiddenUnits>64||model.activation!=='tanh'||model.outputActivation!=='softmax'||model.clip!==5||!finiteVector(model.classPrior,3)||model.classPrior.some(value=>value<=0)||Math.abs(model.classPrior.reduce((a,b)=>a+b,0)-1)>1e-9)return false;
  const h=model.hiddenUnits;
  return Array.isArray(model.hiddenWeights)&&model.hiddenWeights.length===h&&model.hiddenWeights.every(row=>finiteVector(row,dimension))&&finiteVector(model.hiddenBias,h)&&Array.isArray(model.outputWeights)&&model.outputWeights.length===3&&model.outputWeights.every(row=>finiteVector(row,h))&&finiteVector(model.outputBias,3);
}

export function predictNeuralNetwork(features,model,scaler,{temperature=1}={}){
  if(!validScaler(scaler)||!finiteVector(features,scaler.mean.length)||!validNeuralModel(model,scaler.mean.length)||!Number.isFinite(temperature)||temperature<=0)return null;
  const point=transform(features,scaler),hidden=model.hiddenWeights.map((row,h)=>Math.tanh(row.reduce((sum,weight,j)=>sum+weight*point[j],model.hiddenBias[h])));
  const logits=model.outputWeights.map((row,k)=>row.reduce((sum,weight,h)=>sum+weight*hidden[h],model.outputBias[k])/temperature);
  if(logits.some(value=>!Number.isFinite(value)))return null;
  const largest=Math.max(...logits),scores=logits.map(value=>Math.exp(value-largest)),total=scores.reduce((a,b)=>a+b);
  return Number.isFinite(total)&&total>0?scores.map(value=>value/total):null;
}
