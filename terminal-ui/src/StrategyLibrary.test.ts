import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import StrategyLibrary,{selectStrategies} from './StrategyLibrary';
const rules=[
 {id:'rsi',name:'RSI attente',family:'reversion',side:'HOLD',dataReady:true,formula:'RSI 2',directionalChecks:{BUY:[{label:'Croisement manquant',passed:false,value:12}],SELL:[{label:'Seuil rempli',passed:true,value:90}]}},
 {id:'dual',name:'Dual Thrust actif',family:'breakout',side:'BUY',dataReady:true,entry:100,stop:97,target:106,formula:'Canal quatre bougies'},
 {id:'vwap',name:'VWAP sans volume',family:'trend',side:'HOLD',dataReady:false,volumeRequired:true,reason:'real-volume-required',directionalChecks:{BUY:[{label:'ne pas interpréter',passed:true}]}}
];
describe('strategy library',()=>{
 it('shows all states and real criteria without trade authorization',()=>{
  const output=renderToStaticMarkup(createElement(StrategyLibrary,{rules,symbol:'BTC/USD'}));
  for(const text of ['3 règles implémentées','RSI attente','Dual Thrust actif','VWAP sans volume','Croisement manquant','Données manquantes','0/1 conditions','1/1 conditions','sans probabilité de réussite'])expect(output).toContain(text);
  expect(output).not.toContain('ne pas interpréter');expect(output).not.toContain('Ouvrir un trade');
 });
 it('filters real states and combines family and query',()=>{
  expect(selectStrategies(rules,'','waiting','all').map(r=>r.id)).toEqual(['rsi']);
  expect(selectStrategies(rules,'','blocked','all').map(r=>r.id)).toEqual(['vwap']);
  expect(selectStrategies(rules,'canal','active','breakout').map(r=>r.id)).toEqual(['dual']);
  expect(selectStrategies(rules,' RSI ','all','all').map(r=>r.id)).toEqual(['rsi']);
  expect(selectStrategies(rules,'','active','reversion')).toEqual([]);
 });
 it('paginates 80 real rules and escapes names',()=>{
  const many=Array.from({length:80},(_,i)=>({...rules[0],id:String(i),name:i===0?'<script>x</script>':'Recette '+i}));
  const output=renderToStaticMarkup(createElement(StrategyLibrary,{rules:many,symbol:'EUR/USD'}));
  expect(output).toContain('80 règles implémentées');expect(output).toContain('12 affichés');expect(output).toContain('Afficher 12 stratégies de plus');expect(output).not.toContain('Recette 12');expect(output).not.toContain('<script>');
 });
});
