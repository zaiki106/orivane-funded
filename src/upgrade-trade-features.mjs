import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tradeFeatureNames,tradeFeatureNamesV2} from './trade-confidence.mjs';
import {extendTradeFeatures} from './trade-features-v2.mjs';

// Reuses the original causal features, strategy and boundary timestamp only.
// This avoids recalculating indicators or changing plans, labels and partitions.
const [input,output]=process.argv.slice(2);
if(!input||!output||input===output)throw Error('Usage: node src/upgrade-trade-features.mjs INPUT.json NEW.json');
const bytes=await readFile(input),data=JSON.parse(bytes);
if(JSON.stringify(data.features)!==JSON.stringify(tradeFeatureNames))throw Error('Expected original v1 named features');
for(const row of data.examples){
 const features=extendTradeFeatures(row.features,row.strategy,row.entryTimeMs);
 if(!features)throw Error('Invalid causal feature row: '+row.id);
 row.features=features;
}
data.features=[...tradeFeatureNamesV2];
data.metadata={...data.metadata,featureVersion:'strategy-context-v2',testPreviouslyEvaluated:true,parentInputSha256:createHash('sha256').update(bytes).digest('hex')};
await writeFile(output,JSON.stringify(data));
process.stdout.write(JSON.stringify({output,rows:data.examples.length,features:data.features.length})+'\n');
