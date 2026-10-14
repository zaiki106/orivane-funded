import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {collectTradeExamples,splitTradeExamples} from './trade-confidence.mjs';

const args=process.argv.slice(2),get=name=>{const index=args.indexOf(name);return index<0?null:args[index+1];},input=get('--input'),output=get('--output'),symbol=get('--symbol'),mode=get('--strategies')??'routed';
if(!input||!output)throw Error('Usage: node src/export-trade-examples.mjs --input DATA.json --output EXAMPLES.json [--symbol BTC/USD] [--strategies routed|all]');
const parsed=JSON.parse(await readFile(input,'utf8')),datasets=Array.isArray(parsed)?parsed:Array.isArray(parsed.datasets)?parsed.datasets:[parsed],selected=symbol?datasets.filter(dataset=>dataset.symbol===symbol):datasets;
if(!selected.length)throw Error('Instrument absent du fichier');
for(let i=0;i<selected.length;i++){
 const result=collectTradeExamples(selected[i],{strategyMode:mode}),split=splitTradeExamples(result),target=selected.length===1?output:output.replace(/\.json$/i,'')+'-'+selected[i].symbol.replace(/[^a-z0-9]/gi,'_')+'.json';
 result.metadata.partitions={train:split.train.length,calibration:split.calibration.length,test:split.test.length,excluded:split.excluded};
 await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(result));
 process.stdout.write(JSON.stringify({symbol:selected[i].symbol,file:target,examples:result.examples.length,censored:result.metadata.censored,partitions:result.metadata.partitions})+'\n');
}
