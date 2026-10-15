import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileServer} from '../server.mjs';
async function environment(t){const calls=[],server=createMobileServer({cloudHandler:async request=>{calls.push({url:request.url,method:request.method});return Response.json({provider:'test-only'},{headers:{'Cache-Control':'no-store'}});}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return {base:'http://127.0.0.1:'+server.address().port,calls};}
test('hosted server serves actual built UI, workers and release without a desktop dependency',async t=>{
 const {base}=await environment(t);
 const response=await fetch(base+'/');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
 const html=await response.text(),asset=html.match(/src="(\/terminal-ui\/assets\/index-[^"]+\.js)"/);assert.ok(asset);
 const script=await fetch(base+asset[1]);assert.equal(script.status,200);assert.match(script.headers.get('cache-control'),/immutable/);
 for(const route of ['/mobile-bridge.mjs','/core/market-analysis.mjs','/core/price-research.mjs']){const r=await fetch(base+route);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.equal((await (await fetch(base+'/intelligence-release.json')).json()).version,'intelligence-mobile3');
 assert.equal((await (await fetch(base+'/healthz')).json()).status,'ok');
});
test('hosted cloud routes stay on the fixed internal provider path and forward freshness',async t=>{
 const {base,calls}=await environment(t);const response=await fetch(base+'/cloud/kraken?url=https://external.invalid');assert.equal(response.status,200);assert.deepEqual(calls,[{url:'https://mobile.internal/cloud/kraken',method:'GET'}]);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('hosted server does not expose source files, execute POST, or leak errors',async t=>{
 const {base,calls}=await environment(t);
 for(const route of ['/server.mjs','/package.json','/.env','/%2e%2e%2fpackage.json','/missing','/core/'])assert.equal((await fetch(base+route)).status,404,route);
 assert.equal((await fetch(base+'/core%5c..%5cserver.mjs')).status,400);
 assert.equal((await fetch(base+'/%zz')).status,400);
 assert.equal((await fetch(base+'/cloud/kraken',{method:'POST',body:'private'})).status,405);assert.equal(calls.length,0);
 assert.equal((await (await fetch(base+'/',{method:'HEAD'})).text()),'');
});
