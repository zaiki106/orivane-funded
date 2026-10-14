import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const MAX=200*1024*1024,manifest={schemaVersion:1,generatedAt:new Date().toISOString(),budgetBytes:MAX,downloads:[],orders:false};let total=0;
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
async function get(url,file){const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);const size=Number(r.headers.get('content-length')??0);if(size&&total+size>MAX)throw Error('Reference budget exceeded');const body=Buffer.from(await r.arrayBuffer());total+=body.length;if(total>MAX)throw Error('Reference budget exceeded');const dest=path.resolve(root,file);if(!dest.startsWith(root+path.sep))throw Error('Invalid reference destination');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,body);manifest.downloads.push({url,file,bytes:body.length,sha256:sha(body)});return body;}
const leanCommit='ea3d5159152530d58f3afe2feced990a0bf64b96',freqtradeCommit='1f394eaebc2f46a83d26971388628707802f8602',version='2.5.18164';
manifest.lean={version,commit:leanCommit,license:'Apache-2.0',source:'https://github.com/QuantConnect/Lean',runtimeTarget:'net10.0'};
manifest.freqtrade={commit:freqtradeCommit,license:'GPLv3 (upstream metadata)',source:'https://github.com/freqtrade/freqtrade',integration:'isolated-reference-only'};
await Promise.all([
 get(`https://raw.githubusercontent.com/QuantConnect/Lean/${leanCommit}/LICENSE`,'sources/lean/LICENSE'),
 get(`https://raw.githubusercontent.com/QuantConnect/Lean/${leanCommit}/Indicators/SimpleMovingAverage.cs`,'sources/lean/SimpleMovingAverage.cs'),
 get(`https://raw.githubusercontent.com/QuantConnect/Lean/${leanCommit}/Indicators/StandardDeviation.cs`,'sources/lean/StandardDeviation.cs'),
 get(`https://raw.githubusercontent.com/QuantConnect/Lean/${leanCommit}/Indicators/Variance.cs`,'sources/lean/Variance.cs'),
 get(`https://raw.githubusercontent.com/freqtrade/freqtrade/${freqtradeCommit}/LICENSE`,'sources/freqtrade/LICENSE'),
 get(`https://raw.githubusercontent.com/freqtrade/freqtrade/${freqtradeCommit}/README.md`,'sources/freqtrade/README.md'),
 get(`https://raw.githubusercontent.com/freqtrade/freqtrade/${freqtradeCommit}/freqtrade/strategy/interface.py`,'sources/freqtrade/interface.py'),
 get(`https://raw.githubusercontent.com/freqtrade/freqtrade/${freqtradeCommit}/docs/lookahead-analysis.md`,'sources/freqtrade/lookahead-analysis.md'),
 get(`https://raw.githubusercontent.com/freqtrade/freqtrade/${freqtradeCommit}/pyproject.toml`,'sources/freqtrade/pyproject.toml')
]);
const packages=[['quantconnect.indicators',version],['quantconnect.common',version],['quantconnect.logging',version],['quantconnect.configuration',version],['quantconnect.pythonnet','2.0.66'],['mathnet.numerics','5.0.0'],['nodatime','3.0.5'],['protobuf-net.core','3.1.33'],['protobuf-net','3.1.33']];
for(const [id,v] of packages){const base=`https://api.nuget.org/v3-flatcontainer/${id}/${v}/${id}`;await get(base+'.nuspec',`packages/${id}/${v}/${id}.nuspec`);await get(base+'.'+v+'.nupkg',`packages/${id}/${v}/${id}.${v}.nupkg`);}
manifest.totalDownloadedBytes=total;await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({bytes:total,files:manifest.downloads.length,leanCommit,freqtradeCommit,version}));
