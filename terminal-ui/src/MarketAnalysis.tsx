import type {AnyRecord} from './types';
import {FAMILIES,friendlyReason,number,price,stamp} from './presentation';
const directions:Record<string,string>={up:'Structure EMA haussière',down:'Structure EMA baissière',mixed:'Structure EMA mixte',unavailable:'Historique insuffisant'};
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?number(v,0):'—';
export default function MarketAnalysis({payload,symbol,nowMs=Date.now()}:{payload:AnyRecord|null;symbol:string;nowMs?:number}){
 const market=payload?.marketAnalysis,summary=payload?.strategyAnalysis,frames:AnyRecord[]=Array.isArray(market?.frames)?market.frames:[];
 const age=typeof market?.referenceTime==='string'?nowMs-Date.parse(market.referenceTime):NaN;
 const ageLabel=!Number.isFinite(age)?'Date de clôture indisponible':age<0?'Horloge à vérifier':age>1800000?'Historique ancien · actualisation requise':'Historique récent';
 const value=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?price(v,symbol):'—';
 return <section className="market-analysis" aria-label="Analyse technique approfondie">
  <header><h3>Analyse technique approfondie</h3><p>{ageLabel} · {count(market?.closedBars)} bougies de 15 min exploitées</p></header>
  <p>Lectures descriptives sur bougies terminées. Les vues 1 h et 4 h regroupent uniquement des blocs UTC complets, sans créer de bougies manquantes.</p>
  {market?.status==='insufficient'&&<p role="status">Analyse incomplète : {friendlyReason(market.reason)}</p>}
  {market?.gaps>0&&<p role="status">Historique discontinu : {count(market.discardedBars)} anciennes bougies écartées. Seule la dernière séquence continue est analysée ; aucune bougie n’est inventée pour combler les interruptions.</p>}
  <div className="ma-frames">{frames.map(frame=><article key={frame.minutes}>
   <h4>{frame.minutes===15?'15 min':frame.minutes===60?'1 h':'4 h'}</h4><strong>{directions[frame.direction]??'Lecture indisponible'}</strong>
   <p>{count(frame.bars)} bougies complètes · {frame.lastClosedAt?stamp(frame.lastClosedAt):'—'}</p>
   {frame.status==='ready'?<><dl><div><dt>EMA 9 / EMA 21</dt><dd>{value(frame.ema9)} / {value(frame.ema21)}</dd></div><div><dt>ATR Wilder 14</dt><dd>{value(frame.atr)}</dd></div><div><dt>Plus bas / haut des 20 précédentes</dt><dd>{value(frame.support)} / {value(frame.resistance)}</dd></div><div><dt>Clôture face au canal précédent</dt><dd>{frame.breakout==='above'?'Au-dessus':frame.breakout==='below'?'En dessous':'À l’intérieur'}</dd></div></dl><p>Rang de l’amplitude réelle : {typeof frame.rangeRank==='number'?number(frame.rangeRank,0)+' / 100':'—'} parmi {count(frame.rangeReferenceSamples)} bougies antérieures. Ce rang ne prédit pas la direction.</p></>:<p>Minimum : {count(frame.requiredBars??22)} bougies complètes pour la lecture EMA 9/21.</p>}
  </article>)}</div>
  {summary&&<><div className="ma-counts"><div><strong>{count(summary.buy)}</strong><span>BUY de recherche</span></div><div><strong>{count(summary.sell)}</strong><span>SELL de recherche</span></div><div><strong>{count(summary.waiting)}</strong><span>En attente</span></div><div><strong>{count(summary.blocked)}</strong><span>Données manquantes</span></div></div>
   <p className="ma-conflict">{summary.conflict?'Désaccord détecté : des configurations acheteuses et vendeuses coexistent.':'Aucun désaccord BUY/SELL simultané parmi les configurations détectées.'} Les règles peuvent être corrélées ; leur nombre ne constitue ni une probabilité ni une autorisation d’entrée.</p>
   <details><summary>Répartition par famille de stratégies</summary><div className="ma-families"><div><strong>Famille</strong><span>BUY</span><span>SELL</span><span>Attente</span><span>Bloqué</span></div>{(Array.isArray(summary.families)?summary.families:[]).map((family:AnyRecord)=><div key={family.id}><strong>{FAMILIES[family.id]??family.id}</strong><span>{count(family.buy)}</span><span>{count(family.sell)}</span><span>{count(family.waiting)}</span><span>{count(family.blocked)}</span></div>)}</div></details>
   <details open><summary>Configurations partielles à examiner</summary><p>Classement par proportion de critères remplis. Une seule direction par règle est affichée. Une condition peut cesser d’être remplie ; ce classement ne prédit pas le prochain signal.</p>
    <div className="ma-nearest">{(Array.isArray(summary.nearest)?summary.nearest:[]).map((rule:AnyRecord)=><article key={rule.id}><h4>{rule.name} · {rule.side}</h4><p>{count(rule.met)} / {count(rule.total)} conditions remplies</p><ul>{(Array.isArray(rule.missing)?rule.missing:[]).map((label:string,index:number)=><li key={index}>À confirmer : {label}</li>)}</ul></article>)}</div>
    {!summary.nearest?.length&&<p>Aucune configuration partielle avec critères documentés.</p>}
   </details></>}
 </section>;
}
