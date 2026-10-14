import {cp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
let dest;
for(const candidate of ['../../mobile-cloud/public/','../../orivane-mobile-cloud/public/']){const url=new URL(candidate,import.meta.url);try{await access(new URL('mobile-bridge.mjs',url));dest=fileURLToPath(url);break;}catch{}}
if(!dest)throw Error('Missing mobile-cloud public root');
const assets=path.join(dest,'terminal-ui','assets')+path.sep;
if(!assets.startsWith(dest+'terminal-ui')||!assets.endsWith('assets\\')&&!assets.endsWith('assets/'))throw Error('Unsafe generated asset target');
await rm(assets,{recursive:true,force:true});
await mkdir(dest+'terminal-ui',{recursive:true});
await cp(new URL('../dist/assets/',import.meta.url),dest+'terminal-ui/assets/',{recursive:true});
await writeFile(dest+'index.html',await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
console.log('Published UI assets and public/index.html');
