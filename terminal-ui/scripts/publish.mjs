import {cp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
let dest;
for(const candidate of ['../../mobile-cloud/public/','../../orivane-mobile-cloud/public/']){const url=new URL(candidate,import.meta.url);try{await access(new URL('mobile-bridge.mjs',url));dest=fileURLToPath(url);break;}catch{}}
if(!dest)throw Error('Missing mobile-cloud public root');
const assets=path.join(dest,'terminal-ui','assets')+path.sep;
if(!assets.startsWith(dest+'terminal-ui')||!assets.endsWith('assets\\')&&!assets.endsWith('assets/'))throw Error('Unsafe generated asset target');
await rm(assets,{recursive:true,force:true});
await mkdir(dest+'terminal-ui',{recursive:true});
await cp(new URL('../dist/assets/',import.meta.url),dest+'terminal-ui/assets/',{recursive:true});
await writeFile(dest+'index.html',await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
const hashes={};
for(const name of ['mobile-intelligence.mjs','intelligence-ai.mjs','intelligence-strategies.mjs','price-research.mjs','market-analysis.mjs','kraken-history.mjs']){
 const bytes=await readFile(new URL('../../src/'+name,import.meta.url));
 await writeFile(path.join(dest,'core',name),bytes);hashes[name]=createHash('sha256').update(bytes).digest('hex');
}
await writeFile(path.join(dest,'intelligence-release.json'),JSON.stringify({schemaVersion:1,version:'intelligence-mobile3',requiresPC:false,generatedAt:new Date().toISOString(),modules:hashes},null,2)+'\n');
console.log('Published UI assets and public/index.html');
