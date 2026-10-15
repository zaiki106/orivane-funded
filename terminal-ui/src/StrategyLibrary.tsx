import {useState} from 'react';
import type {AnyRecord} from './types';
import {FAMILIES,number,price} from './presentation';
import {mobileReason,researchSide} from './MobileIntelligence';

export function selectStrategies(rules:AnyRecord[],query:string,status:string,family:string){
 const search=query.trim().toLocaleLowerCase('fr');
 return rules.filter(rule=>(!search||[rule.name,rule.id,rule.formula,...(rule.indicators??[])].join(' ').toLocaleLowerCase('fr').includes(search))&&
  (family==='all'||rule.family===family)&&(status==='all'||status==='active'&&['BUY','SELL'].includes(rule.side)||status==='blocked'&&rule.dataReady===false||status==='waiting'&&rule.side==='HOLD'&&rule.dataReady!==false));
}
function Criteria({title,checks}:{title:string;checks:AnyRecord[]}){
 return <div><h4>{title} · {checks.filter(c=>c.passed).length}/{checks.length} conditions</h4><ul>{checks.map((item,index)=><li key={index} className={item.passed?'met':'unmet'}><span aria-label={item.passed?'Remplie':'Manquante'}>{item.passed?'✓':'○'}</span> {item.label}{typeof item.value==='number'&&Number.isFinite(item.value)&&<small> · valeur : {number(item.value,4)}</small>}</li>)}</ul></div>;
}
export default function StrategyLibrary({rules,symbol}:{rules:AnyRecord[];symbol:string}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState('all'),[family,setFamily]=useState('all'),[limit,setLimit]=useState(12);
 const selected=selectStrategies(rules,query,status,family),active=rules.filter(r=>['BUY','SELL'].includes(r.side)).length,blocked=rules.filter(r=>r.dataReady===false).length;
 const reset=()=>setLimit(12);
 return <section className="strategy-library" aria-label="Bibliothèque des stratégies">
  <header><h3>Bibliothèque des stratégies</h3><p>{rules.length} règles implémentées · {active} configurations détectées · {blocked} bloquées par les données</p></header>
  <p>Chaque règle est calculée sur la dernière clôture. « En attente » signifie que ses conditions ne sont pas toutes réunies ; « Données manquantes » signifie que le calcul est bloqué. Une configuration de recherche ne vaut pas validation du modèle.</p>
  <div className="sl-toolbar"><label>Rechercher<input type="search" value={query} onChange={e=>{setQuery(e.target.value);reset();}} placeholder="RSI, cassure, tendance…"/></label>
   <label>État<select value={status} onChange={e=>{setStatus(e.target.value);reset();}}><option value="all">Tous les états</option><option value="active">BUY / SELL de recherche</option><option value="waiting">En attente de conditions</option><option value="blocked">Données manquantes</option></select></label>
   <label>Famille<select value={family} onChange={e=>{setFamily(e.target.value);reset();}}><option value="all">Toutes les familles</option>{[...new Set(rules.map(r=>r.family).filter(Boolean))].map(value=><option key={value} value={value}>{FAMILIES[value]??value}</option>)}</select></label></div>
  <p role="status">{selected.length} résultat{selected.length===1?'':'s'} · {Math.min(limit,selected.length)} affiché{Math.min(limit,selected.length)===1?'':'s'}</p>
  <div className="sl-list">{selected.slice(0,limit).map(rule=>{
   const side=researchSide(rule.side),isActive=side==='BUY'||side==='SELL',dataBlocked=rule.dataReady===false;
   const buy=Array.isArray(rule.directionalChecks?.BUY)?rule.directionalChecks.BUY:[],sell=Array.isArray(rule.directionalChecks?.SELL)?rule.directionalChecks.SELL:[];
   return <details key={rule.id} className="sl-rule"><summary><span><small>{FAMILIES[rule.family]??'Recherche'}</small><strong>{rule.name}</strong></span><em className={isActive?side?.toLowerCase():''}>{dataBlocked?'Données manquantes':isActive?side+' · recherche':'En attente'}</em></summary>
    <div className="sl-body"><p>{rule.formula??mobileReason(rule.reason)}</p><p>{mobileReason(rule.reason)}</p>
     <p className="sl-prerequisites">{rule.warmupBars??120} bougies minimum · 15 min · {rule.volumeRequired?'Volume réel requis':'Volume non requis'}</p>
     {isActive&&<dl className="mi-levels">{[['Entrée théorique','entry'],['Stop','stop'],['Objectif','target']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{typeof rule[key]==='number'&&Number.isFinite(rule[key])&&rule[key]>0?price(rule[key],symbol):'—'}</dd></div>)}</dl>}
     {!dataBlocked&&(buy.length>0||sell.length>0)&&<div className="sl-criteria"><Criteria title="Conditions BUY" checks={buy}/><Criteria title="Conditions SELL" checks={sell}/><p>Le nombre de conditions remplies est un diagnostic technique, sans probabilité de réussite.</p></div>}
     {dataBlocked&&<p>Les conditions directionnelles ne sont pas interprétables tant que les données requises sont absentes.</p>}
    </div></details>;
  })}</div>
  {!selected.length&&<p>Aucune règle ne correspond à ces filtres.</p>}
  {selected.length>limit&&<button className="secondary" type="button" onClick={()=>setLimit(v=>v+12)}>Afficher 12 stratégies de plus</button>}
 </section>;
}
