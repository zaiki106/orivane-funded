import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split('// Presentation only: no price interpolation, signal calculation or network access.')[1];
function environment({reduce=false,savedMode=null}={}){
  let value='100.00',fresh=true,observer,requests=0,saved=savedMode;const frames=[],animations=[],listeners=new Map(),classes=new Set();
  const reduced={matches:reduce,addEventListener(name,fn){this.change=fn;}},fine={matches:true};
  const root={animate(){},classList:{add:name=>classes.add(name),contains:name=>classes.has(name),toggle(name,on){on?classes.add(name):classes.delete(name);}}};
  const price={isConnected:true,get textContent(){return value;},set textContent(_){throw Error('Motion must not write prices');},animate(keyframes,options){const handlers={},animation={keyframes,options,cancelled:false,addEventListener:name=>{},cancel(){this.cancelled=true;handlers.cancel?.();}};animation.addEventListener=(name,fn)=>handlers[name]=fn;animations.push(animation);return animation;}};
  const view={querySelectorAll:()=>[],querySelector:selector=>selector==='.quote-value b'?price:null};
  const document={hidden:false,documentElement:root,querySelector:selector=>selector==='#view'?view:null,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const market=Object.freeze({symbol:'BTC/USD',live:true,decision:Object.freeze({side:'HOLD',confidence:Object.freeze({percent:30})})});
  vm.runInNewContext(source,{document,window:{matchMedia:query=>query.includes('reduced-motion')?reduced:fine,addEventListener(){}},localStorage:{getItem:()=>saved,setItem:(key,value)=>{saved=value;}},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},pushFresh:()=>fresh,selected:()=>market,fetch(){requests++;throw Error('No network allowed');},console});
  const flush=()=>{let count=0;while(frames.length){assert.ok(++count<20,'No mutation/animation feedback loop');frames.shift()();}};flush();
  return {animations,classes,market,get value(){return value;},get saved(){return saved;},get requests(){return requests;},toggle(){listeners.get('click')({target:{closest:()=>({})}});flush();},update(next=value){value=next;observer();flush();},setFresh(on){fresh=on;observer();flush();},reduce(on){reduced.matches=on;reduced.change();flush();},hidden(on){document.hidden=on;listeners.get('visibilitychange')();flush();}};
}
test('motion highlights actual changed quote text once, without interpolating data or issuing requests',()=>{
  const e=environment();assert.equal(e.animations.length,0);e.update();assert.equal(e.animations.length,0);
  e.update('101.25');assert.equal(e.animations.length,1);assert.equal(e.value,'101.25');e.update();assert.equal(e.animations.length,1);
  e.update('99.00');assert.equal(e.animations.length,2);assert.equal(e.market.decision.confidence.percent,30);assert.equal(e.market.decision.side,'HOLD');assert.equal(e.requests,0);
});
test('interrupted data never pulses cached quotes as live',()=>{
  const e=environment();e.setFresh(false);e.update('102.00');assert.equal(e.animations.length,0);assert.equal(e.classes.has('motion-live'),false);
  e.setFresh(true);assert.equal(e.animations.length,0);e.update('103.00');assert.equal(e.animations.length,1);
});
test('reduced motion and hidden pages cancel active presentation and preserve visible numbers',()=>{
  const e=environment();e.update('104.00');e.reduce(true);assert.equal(e.animations[0].cancelled,true);assert.equal(e.classes.has('motion-paused'),true);
  e.update('105.00');assert.equal(e.animations.length,1);assert.equal(e.value,'105.00');e.reduce(false);e.update('106.00');assert.equal(e.animations.length,2);
  e.hidden(true);assert.equal(e.animations[1].cancelled,true);e.update('107.00');assert.equal(e.animations.length,2);assert.equal(e.value,'107.00');e.hidden(false);assert.equal(e.classes.has('motion-paused'),false);
  const reduced=environment({reduce:true});reduced.update('108.00');assert.equal(reduced.animations.length,0);
});
test('explicit Motion activation can override system reduction, persists, and can be disabled again',()=>{
  const e=environment({reduce:true});assert.equal(e.classes.has('motion-paused'),true);e.toggle();assert.equal(e.saved,'on');assert.equal(e.classes.has('motion-force'),true);e.update('102.00');assert.equal(e.animations.length,1);
  e.hidden(true);assert.equal(e.animations[0].cancelled,true);e.hidden(false);e.toggle();assert.equal(e.saved,'off');e.update('103.00');assert.equal(e.animations.length,1);
  const restored=environment({reduce:true,savedMode:'on'});restored.update('104.00');assert.equal(restored.animations.length,1);assert.equal(restored.classes.has('motion-force'),true);
});
