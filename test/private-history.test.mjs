import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

test('a clean checkout starts without private historical files and creates no prices',async()=>{
  const missing=join(tmpdir(),'orivane-absent-history-'+randomUUID());
  const app=createApp({dbPath:':memory:',network:false,historyPath:missing,importsPath:missing});
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/state');
    assert.equal(response.status,200);
    const state=await response.json();
    assert.equal(state.radar.length,5);
    for(const market of state.radar){
      assert.equal(market.quote,null);
      assert.equal(market.decision.side,'HOLD');
      assert.equal(market.coverage,0);
    }
  }finally{await app.close();}
});
