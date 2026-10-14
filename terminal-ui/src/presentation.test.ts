import {describe,it,expect} from 'vitest';
import {tradeDisplay,safeArticle,privateImport,validState,journalOverview,friendlyReason} from './presentation';
import type {Market,State} from './types';
const state={profile:{confirmed:true},account:{breached:false},radar:[],positions:[],strategyCatalog:[]} as State;
const market=(percent:number,kind='tp_before_sl_probability')=>({symbol:'BTC/USD',bars:[],feed:{status:'live'},live:true,eligible:true,decision:{side:'BUY',confidence:{kind,percent},confidenceGate:{passed:true},modelAssessment:{passed:true},executionPlan:{valid:true}}}) as Market;
describe('published signal boundary',()=>{
 it('strictly rejects 60 and displays a proven greater estimate',()=>{expect(tradeDisplay(market(60),state,true).side).toBe('HOLD');expect(tradeDisplay(market(60.1),state,true)).toMatchObject({side:'BUY',executable:true,percent:60.1});});
 it('cannot call an old directional confidence a trade probability',()=>{expect(tradeDisplay(market(91,'market_direction'),state,true)).toMatchObject({side:'HOLD',percent:null,executable:false});});
 it('a disconnected stream cannot retain a paper entry or stale confidence',()=>{expect(tradeDisplay(market(84),state,false)).toMatchObject({side:'HOLD',executable:false,percent:null});});
 it('a missing assessment or invalid plan prevents publication',()=>{const m=market(84);m.decision.modelAssessment.passed=false;expect(tradeDisplay(m,state,true).side).toBe('HOLD');m.decision.modelAssessment.passed=true;m.decision.executionPlan.valid=false;expect(tradeDisplay(m,state,true).side).toBe('HOLD');});
 it('rejects missing or nonfinite probabilities',()=>{expect(tradeDisplay(market(NaN),state,true).side).toBe('HOLD');expect(tradeDisplay(market(Infinity),state,true).percent).toBe(null);});
});
describe('untrusted content',()=>{
 it('news requires safe URL and an actual publication date',()=>{expect(safeArticle({url:'javascript:alert(1)',publishedAt:'2026-10-12',title:'unsafe'})).toBe(null);expect(safeArticle({url:'https://example.com',title:'undated'})).toBe(null);expect(safeArticle({url:'https://example.com/a',publishedAt:'2026-10-12T08:00:00Z',title:'Real title',source:{name:'Publisher'}})).toMatchObject({source:'Publisher',title:'Real title'});});
 it('private import requires structural fields and bounded rows',()=>{expect(()=>privateImport({profile:{},positions:[]})).toThrow();expect(()=>privateImport({profile:{},positions:new Array(10001),history:[]})).toThrow();expect(privateImport({profile:{},positions:[],history:[]})).toMatchObject({positions:[]});});
 it('state refuses duplicated instruments',()=>{const radar=['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX'].map(s=>({...market(84),symbol:s}));expect(validState({...state,positions:[],radar})).toBe(true);radar[4].symbol='BTC/USD';expect(validState({...state,positions:[],radar})).toBe(false);});
 it('corrupted private state never presents defaults as a restored ledger',()=>{const blocked={...state,account:{equity:100000,realized:0,openRisk:0},platform:{privateRestore:{status:'blocked'}}};expect(journalOverview(blocked)).toEqual({equity:null,realized:null,openPositions:null,openRisk:null});expect(tradeDisplay(market(84),blocked,true).executable).toBe(false);});
 it('technical rejection codes get a readable explanation without losing real measurements',()=>{expect(friendlyReason('Modèle objectif/stop en observation : incompatible-target-model')).toContain('n’est pas encore disponible');expect(friendlyReason('model-source-mismatch')).toContain('source différente');expect(friendlyReason('58.2 %')).toBe('58.2 %');});
});
