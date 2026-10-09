import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createCloudApp} from '../src/cloud-server.mjs';
const password='test-only-private-password-123456';
const authorization='Basic '+Buffer.from('orivane:'+password).toString('base64');
test('cloud configuration refuses insecure origins and missing authentication',async()=>{
  for(const options of [{origin:'http://example.com',password},{origin:'https://example.com/path',password},{origin:'https://example.com',password:'short'}])await assert.rejects(createCloudApp(options));
});
test('cloud protects HTML, state, export and streaming while health exposes only readiness',async()=>{
  const app=await createCloudApp({origin:'https://terminal.example',password,terminalOptions:{dbPath:':memory:',network:false,importsPath:''}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const request=(url,headers={})=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:app.server.address().port,path:url,headers:{host:'terminal.example',...headers}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));}).on('error',reject);});
  try{
    for(const url of ['/','/api/state','/api/export','/api/stream']){const r=await request(url);assert.equal(r.status,401);assert.match(r.headers['www-authenticate'],/Basic/);assert.doesNotMatch(r.body,/token|positions/);}
    assert.equal((await request('/healthz')).body,'ok');
    assert.equal((await request('/api/state',{authorization:'Basic '+Buffer.from('orivane:wrong').toString('base64')})).status,401);
    for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}])assert.equal((await request('/api/state',{authorization,...headers})).status,403);
    const state=await request('/api/state',{authorization,origin:'https://terminal.example'});assert.equal(state.status,200);assert.equal(JSON.parse(state.body).radar.length,5);
    assert.equal((await request('/',{authorization})).status,200);
  }finally{await app.close();}
});
