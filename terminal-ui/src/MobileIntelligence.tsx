import type {Market,State,AnyRecord} from './types';
import {FAMILIES,friendlyReason,number,price,stamp,tradeDisplay} from './presentation';
import StrategyLibrary from './StrategyLibrary';
import MarketAnalysis from './MarketAnalysis';

const publicationLabels:Record<string,string>={
  insufficient_nonoverlapping_oos:'Le test séparé ne comporte pas encore assez de trades sans chevauchement.',
  insufficient_outcome_classes:'Le test ne contient pas assez de réussites et d’échecs pour valider le modèle.',
  insufficient_above_60_percent:'Trop peu de plans du test dépassent strictement le seuil de 60 %.',
  no_brier_advantage:'Les probabilités ne font pas mieux que la référence sur le test séparé (score de Brier).',
  net_expectancy_not_demonstrated:'Une espérance nette positive après coûts n’est pas démontrée.',
  fresh_holdout_required_after_reassessment:'Une nouvelle période de test intacte est nécessaire après la réévaluation.',
  insufficient_oos:'Il manque des observations sur une période de test séparée.',
};
const localReasons:Record<string,string>={
  'ready':'Analyse disponible sur cet appareil.',
  'real-volume-required':'Cette analyse exige un volume réel, absent sur ce flux. Les autres règles du moteur restent consultables.',
  'setup-not-confirmed':'Aucune configuration de cette recette n’est confirmée sur les dernières bougies clôturées.',
  'closed-setup-confirmed':'Configuration technique détectée sur une bougie clôturée, pour la recherche uniquement.',
  'zero-atr':'Les variations disponibles ne permettent pas de calculer des niveaux de risque.',
  'invalid-risk-levels':'Les niveaux de risque de cette configuration ne sont pas exploitables.',
  'timezone-required':'Les dates des bougies doivent inclure leur fuseau horaire.',
  'unaligned-time':'Les bougies ne sont pas alignées sur la grille de 15 minutes.',
  'invalid-ohlc':'Certaines bougies de prix sont invalides.',
  'insufficient-reference-history':'L’historique de référence est encore insuffisant pour comparer les contextes.',
};
export function mobileReason(value:unknown):string {
  if(typeof value!=='string'||!value.trim())return '—';
  return localReasons[value]??publicationLabels[value]??friendlyReason(value);
}
export function publicationRejections(market:Market|undefined,state:State|null):string[] {
  const platformModel=Array.isArray(state?.platform?.models)?state.platform.models.find((model:AnyRecord)=>model?.symbol===market?.symbol):null;
  const sources=[market?.tradeModel?.publication,market?.decision?.modelAssessment?.publication,market?.decision?.modelAssessment,platformModel?.publication];
  return [...new Set(sources.flatMap(source=>Array.isArray(source?.rejectionReasons)?source.rejectionReasons.filter((reason:unknown):reason is string=>typeof reason==='string'&&reason.length>0):[]))] as string[];
}
export function contextLabel(value:unknown):string {
  const context=value as AnyRecord|undefined;
  return context?.status==='estimated'&&Number.isSafeInteger(context.regime)&&context.regime>=0?'Contexte '+context.regime:'—';
}
export function researchSide(value:unknown):'BUY'|'SELL'|'HOLD'|null {return value==='BUY'||value==='SELL'||value==='HOLD'?value:null;}
export function mobileStamp(value:unknown,seconds=false):string {
  if(typeof value==='number')return Number.isFinite(value)&&Math.abs(value)<=8640000000000000?stamp(new Date(value).toISOString(),seconds):'—';
  return stamp(value,seconds);
}
function volumeLabel(value:unknown):string {
  const status=typeof value==='string'?value:(value as AnyRecord|undefined)?.status;
  return ({available:'Volume réel disponible',real:'Volume réel disponible',unavailable:'Volume réel indisponible',missing:'Volume absent',partial:'Volume incomplet',unknown:'Volume non confirmé'} as Record<string,string>)[status]??(typeof status==='string'?mobileReason(status):'—');
}
function sampleCount(value:unknown) {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?number(value,0):'—';}
function ResearchSetup({setup,symbol}:{setup:AnyRecord;symbol:string}) {
  const side=researchSide(setup.side),active=side==='BUY'||side==='SELL';
  const level=(value:unknown)=>typeof value==='number'&&value>0&&Number.isFinite(value)?price(value,symbol):'—';
  return <article className={'mi-setup'+(active?' mi-setup-active':'')}>
    <div className="mi-setup-heading"><div><small>{FAMILIES[setup.family]??'Recherche'}</small><h3>{typeof setup.name==='string'?setup.name:'Recette de recherche'}</h3></div><span className={'mi-side '+(side?.toLowerCase()??'unknown')}>{side==='HOLD'?'En attente':side??'—'}<small>recherche</small></span></div>
    <p className="mi-explanation">{mobileReason(setup.reason)}</p>
    {active&&<dl className="mi-levels"><div><dt>Entrée théorique</dt><dd>{level(setup.entry)}</dd></div><div><dt>Stop figé</dt><dd>{level(setup.stop)}</dd></div><div><dt>Objectif</dt><dd>{level(setup.target)}</dd></div></dl>}
  </article>;
}

export default function MobileIntelligence({market,state}:{market:Market|undefined;state:State|null}) {
  const payload=market?.intelligence?.version==='mobile-intelligence-v1'?market.intelligence:null;
  const setups:AnyRecord[]=Array.isArray(payload?.strategies)?payload.strategies.filter((item:unknown)=>item&&typeof item==='object'):[];
  const engineSetups:AnyRecord[]=Array.isArray(payload?.engineSetups)?payload.engineSetups.filter((item:AnyRecord)=>item&&['BUY','SELL'].includes(item.side)):[];
  const engineRules:AnyRecord[]=Array.isArray(payload?.engineStrategies)?payload.engineStrategies:engineSetups;
  const priceRules:AnyRecord[]=Array.isArray(payload?.priceStrategies)?payload.priceStrategies:[];
  const libraryRules=[...engineRules,...setups.map(rule=>({...rule,dataReady:payload?.status==='ready',volumeRequired:true})),...priceRules];
  const connected=!market?.connectionError,display=tradeDisplay(market,state,connected&&market?.live===true);
  const rejections=publicationRejections(market,state),local=state?.runtime?.onDevice===true||payload?.requiresPC===false;
  const evaluated=mobileStamp(payload?.evaluatedAt,true),reference=mobileStamp(payload?.referenceTime);
  const measured=payload?.drift?.status==='measured',psi=measured&&typeof payload.drift.maxPsi==='number'&&Number.isFinite(payload.drift.maxPsi)&&payload.drift.maxPsi>=0?number(payload.drift.maxPsi,3):'—';
  const status=!payload?'Initialisation':payload.status==='ready'?'Calcul disponible':payload.status==='insufficient'?'Données insuffisantes':'État indisponible';
  return <section className="panel mobile-intelligence" aria-label="Intelligence sur cet appareil">
    <header className="mi-heading"><div><span className="eyebrow">Analyse locale · {market?.symbol??'Marché en chargement'}</span><h2>Intelligence sur cet appareil</h2><p>{local?'PC éteint : calcul sur le téléphone':'Initialisation du calcul sur cet appareil'}</p></div><span className="mi-state">{status}</span></header>
    <p className="mi-runtime-note">Une connexion Internet et cette page ouverte sont nécessaires pour recevoir les marchés. Si le navigateur suspend la page en arrière-plan, le suivi peut s’interrompre.</p>
    {market?.connectionError&&<div className="mi-connection-error" role="status"><strong>Flux à reconnecter</strong><p>{mobileReason(market.connectionError)}</p><small>Les derniers calculs affichés peuvent être anciens. Ils seront réévalués à la réception des nouvelles données.</small></div>}
    <div className="mi-time"><span>Actualisé : {evaluated}</span><span>Dernière clôture analysée : {reference}</span>{state?.runtime?.lastResumedAt&&<span>Reprise sur cet appareil : {mobileStamp(state.runtime.lastResumedAt,true)}</span>}{typeof state?.runtime?.version==='string'&&<span>Version mobile : {state.runtime.version}</span>}</div>
    <div className="mi-official"><div className="mi-official-heading"><div><small>Décision officielle</small><h3>{display.side}</h3></div><span>{display.modelLabel}</span></div><p>{market?.decision?.reason?mobileReason(market.decision.reason):display.reason}</p>{rejections.length>0&&<div className="mi-validation"><h3>Ce qui bloque la validation du modèle</h3><ul>{rejections.map(reason=><li key={reason} title={reason}>{mobileReason(reason)}</li>)}</ul></div>}</div>
    <div className="mi-diagnostics"><div><span>Regroupement statistique</span><strong>{contextLabel(payload?.regime)}</strong><small>Indice de groupe, sans direction de marché attribuée.</small></div><div><span>Écart des distributions · PSI max.</span><strong>{psi}</strong><small>Écart observé entre fenêtres, sans seuil de trading validé.</small></div><div><span>Fenêtres de comparaison</span><strong>{sampleCount(payload?.training?.referenceSamples)} / {sampleCount(payload?.training?.currentSamples)}</strong><small>Observations de référence / récentes. {volumeLabel(payload?.volumeStatus)}</small></div></div>
    {payload?.marketAnalysis&&<MarketAnalysis payload={payload} symbol={market?.symbol??''}/>}
    <div className="mi-research-heading"><div><h3>Configurations de recherche</h3><p>Les BUY et SELL ci-dessous décrivent des recettes techniques. Ils n’autorisent pas une entrée et ne changent pas la décision officielle.</p></div></div>
    <details className="mi-engine-setups" open={engineSetups.length>0}><summary>{engineSetups.length} configuration{engineSetups.length===1?'':'s'} détectée{engineSetups.length===1?'':'s'} parmi les 66 règles du moteur</summary>{engineSetups.length?<div className="mi-setups">{engineSetups.map(setup=><ResearchSetup key={setup.id} setup={setup} symbol={market?.symbol??''}/>)}</div>:<p className="mi-empty">Aucun déclencheur BUY ou SELL terminé parmi ces règles pour cette clôture.</p>}</details>
    {libraryRules.length>0&&<StrategyLibrary key={market?.symbol} rules={libraryRules} symbol={market?.symbol??''}/>}
    {payload?.reason&&<p className="mi-payload-reason">{mobileReason(payload.reason)}</p>}
    {setups.length?<div className="mi-setups">{setups.map((setup,index)=><ResearchSetup key={typeof setup.id==='string'?setup.id:index} setup={setup} symbol={market?.symbol??''}/>)}</div>:<p className="mi-empty">{!payload?'Chargement des calculs sur cet appareil…':payload.status==='insufficient'?'Les configurations apparaîtront lorsque suffisamment de bougies clôturées et exploitables seront disponibles.':'Aucune configuration de recherche fournie par ce calcul.'}</p>}
    <p className="mi-method-note">Recettes en recherche, sans probabilité de réussite attribuée. Le contexte et la dérive sont calculés sur les bougies reçues ; ils ne prouvent pas une rentabilité.</p>
  </section>;
}
