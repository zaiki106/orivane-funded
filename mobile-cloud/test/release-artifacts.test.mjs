import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateTradeModel} from '../public/core/trade-inference.mjs';
import {tradeFeatureNames,tradeFeatureNamesV2} from '../public/core/trade-confidence.mjs';
const publicRoot=new URL('../public/',import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,publicRoot),'utf8'));
test('published manifest keeps the worker protocol and verifiable model/audit lineage',async()=>{
 const platform=await json('platform.json'),index=await json('models/index.json');
 assert.equal(platform.version,'wallstreet12');assert.ok(Array.isArray(platform.models));
 assert.equal(index.schemaVersion,1);
 for(const entry of index.models){
  assert.match(entry.url,/^\/models\/[a-f0-9]+\.json$/);
  const bytes=await readFile(new URL(entry.url.slice(1),publicRoot)),model=JSON.parse(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const expected=model.featureNames.length===tradeFeatureNamesV2.length?tradeFeatureNamesV2:tradeFeatureNames;
  assert.equal(validateTradeModel(model,{symbol:entry.symbol,source:model.source,cost:model.cost,featureNames:expected}).valid,true);
  assert.equal(platform.models.find(m=>m.symbol===entry.symbol)?.id,model.id);
  const audit=await json(entry.auditUrl.slice(1));
  assert.equal(audit.id,model.id);assert.equal(audit.modelSha256,entry.sha256);
  if(model.publication.evaluationRole==='historical-reassessment')assert.equal(model.publication.passed,false);
 }
});
