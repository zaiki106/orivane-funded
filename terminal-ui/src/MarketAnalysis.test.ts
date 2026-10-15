import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MarketAnalysis from './MarketAnalysis';
const now=Date.parse('2026-10-15T10:30:00Z');
const frame={minutes:15,bars:720,status:'ready',direction:'up',ema9:101,ema21:100,atr:2,support:90,resistance:110,close:105,breakout:'inside',rangeRank:65,rangeReferenceSamples:60,lastClosedAt:'2026-10-15T10:30:00Z'};
const payload={marketAnalysis:{status:'ready',closedBars:720,referenceTime:'2026-10-15T10:30:00Z',frames:[frame,{minutes:60,bars:180,status:'ready',direction:'down'},{minutes:240,bars:12,status:'insufficient',direction:'unavailable'}]},strategyAnalysis:{buy:2,sell:3,waiting:82,blocked:1,conflict:true,families:[{id:'trend',buy:2,sell:3,waiting:40,blocked:1}],nearest:[{id:'x',name:'Exemple partiel',side:'BUY',met:2,total:3,missing:['Clôture au-dessus du seuil']}]}};
const html=(p:any=payload)=>renderToStaticMarkup(createElement(MarketAnalysis,{payload:p,symbol:'BTC/USD',nowMs:now}));
describe('in-depth market analysis',()=>{
 it('shows actual multi-timeframe values and preserves insufficient larger timeframe',()=>{const output=html();for(const value of ['15 min','1 h','4 h','Structure EMA haussière','Structure EMA baissière','Historique insuffisant','blocs UTC complets','EMA 9 / EMA 21','ATR Wilder 14'])expect(output).toContain(value);expect(output).not.toContain('Acheter');});
 it('explains simultaneous opposite research setups and pending criteria without success probability',()=>{const output=html();for(const value of ['Désaccord détecté','peuvent être corrélées','ne constitue ni une probabilité','Exemple partiel','2 / 3 conditions','À confirmer : Clôture au-dessus du seuil'])expect(output).toContain(value);expect(output).not.toContain('66 %');});
 it('distinguishes current, stale, future and unknown history clocks',()=>{expect(html()).toContain('Historique récent');expect(html({...payload,marketAnalysis:{...payload.marketAnalysis,referenceTime:'2026-10-15T08:00:00Z'}})).toContain('Historique ancien');expect(html({...payload,marketAnalysis:{referenceTime:'2026-10-15T11:00:00Z'}})).toContain('Horloge à vérifier');expect(html(null)).toContain('Date de clôture indisponible');});
 it('escapes provider-controlled names and reports unavailable numeric values honestly',()=>{const output=html({...payload,strategyAnalysis:{...payload.strategyAnalysis,nearest:[{id:'x',name:'<script>x</script>',met:0,total:1,missing:['<img src=x>']}]}});expect(output).not.toContain('<script>');expect(output).not.toContain('<img');expect(output).toContain('&lt;script&gt;');expect(output).not.toContain('NaN');});
});

it('explains a retained continuous suffix instead of hiding older gaps or fabricating bars',()=>{
 const output=html({...payload,marketAnalysis:{...payload.marketAnalysis,gaps:1,discardedBars:123}});
 expect(output).toContain('Historique discontinu');expect(output).toContain('123 anciennes bougies écartées');expect(output).toContain('dernière séquence continue');expect(output).toContain('aucune bougie n’est inventée');
});
