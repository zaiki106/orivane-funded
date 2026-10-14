import type {Market,State,TradeDisplay,AnyRecord} from './types';
export const SYMBOLS=['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX'];
export const FAMILIES:Record<string,string>={trend:'Tendance',breakout:'Cassure',reversion:'Réversion','price-structure':'Structure de prix',volatility:'Volatilité',session:'Sessions','multi-timeframe':'Multi-unité','economic-event':'Événements économiques',microstructure:'Microstructure','cross-market':'Relations entre marchés'};
const REASONS:Record<string,string>={
 'expired-entry-window':'La fenêtre d’entrée de cette configuration est terminée.',
 'missing-trade-model':'Modèle objectif/stop encore indisponible pour ce marché.',
 'incompatible-target-model':'Le modèle objectif/stop n’est pas encore disponible ou compatible.',
 'unpublished-trade-model':'Le modèle objectif/stop attend sa validation pour le paper.',
 'insufficient-out-of-sample-trades':'Le test séparé ne contient pas encore assez de trades observés.',
 'unvalidated-trade-edge':'L’avantage du modèle n’est pas validé sur le test séparé.',
 'model-source-mismatch':'Les cotations actuelles viennent d’une source différente de celle du modèle.',
 'missing-model-provenance':'La source d’entraînement du modèle est incomplète.',
 'model-cost-mismatch':'Les frais actuels diffèrent des frais utilisés pour entraîner le modèle.',
 'model-expiry-mismatch':'L’expiration du modèle diffère de celle du plan de trade.',
 'invalid-model-predictor':'Le fichier du modèle doit être vérifié avant utilisation.',
 'invalid-model-calibration':'La calibration du modèle est absente ou invalide.',
 'future-model':'Le modèle utilise des observations postérieures à cette décision.',
 'future-publication-evidence':'La validation est postérieure à cette décision.',
 'evidence-before-model-calibration':'Le rapport de validation est antérieur à la calibration du modèle.',
 'invalid-test-observation':'Certaines observations du test ne sont pas exploitables.',
 'invalid-test-input':'Le jeu de test doit être vérifié.',
 'real-volume-required':'Cette stratégie exige un volume réellement fourni.',
 'insufficient-history':'Historique encore trop court pour cette stratégie.',
 'non-contiguous-history':'L’historique contient des bougies manquantes.',
 'unavailable':'Indisponible', 'live':'Direct', 'snapshot':'Instantané', 'closed':'Marché fermé', 'stale':'Cotation ancienne'
};
export function friendlyReason(reason:unknown){const text=typeof reason==='string'?reason:'Analyse en cours';const found=Object.keys(REASONS).find(code=>text===code||text.includes(code));return found?REASONS[found]:text;}
export const LABELS:Record<string,{short:string;name:string;icon:string}>={
 'BTC/USD':{short:'BTC',name:'Bitcoin',icon:'₿'},'EUR/USD':{short:'EUR/USD',name:'Euro / Dollar',icon:'€'},'GBP/USD':{short:'GBP/USD',name:'Livre / Dollar',icon:'£'},'XAU/USD':{short:'GOLD',name:'Or',icon:'Au'},NDX:{short:'NASDAQ',name:'Nasdaq 100',icon:'N'}};
export function number(value:unknown,digits=2){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('fr-FR',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—';}
export const price=(v:unknown,symbol:string)=>number(v,symbol==='EUR/USD'||symbol==='GBP/USD'?5:2);
export function privateRecoveryBlocked(state:State|null){return state?.platform?.privateRestore?.status==='blocked';}
export function journalOverview(state:State|null){return privateRecoveryBlocked(state)?{equity:null,realized:null,openPositions:null,openRisk:null}:{equity:state?.account.equity??null,realized:state?.account.realized??null,openPositions:state?state.positions.filter(p=>p.status==='open').length:null,openRisk:state?.account.openRisk??null};}
export function stamp(value:unknown,seconds=false){const t=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(t)?new Intl.DateTimeFormat('fr-FR',{day:seconds?undefined:'2-digit',month:seconds?undefined:'short',hour:'2-digit',minute:'2-digit',second:seconds?'2-digit':undefined}).format(t):'—';}
export function validState(value:unknown):value is State{
 const s=value as State;return !!s&&Array.isArray(s.radar)&&s.radar.length===5&&new Set(s.radar.map(m=>m.symbol)).size===5&&s.radar.every(m=>SYMBOLS.includes(m.symbol)&&Array.isArray(m.bars)&&m.decision&&['BUY','SELL','HOLD'].includes(m.decision.side)&&m.feed)&&s.profile&&s.account&&Array.isArray(s.positions);
}
export function tradeDisplay(market:Market|undefined,state:State|null,streamFresh:boolean):TradeDisplay{
 const d=market?.decision??{},c=d.confidence??{},trade=c.kind==='tp_before_sl_probability',active=d.side==='BUY'||d.side==='SELL',percent=streamFresh&&trade&&typeof c.percent==='number'&&Number.isFinite(c.percent)&&c.percent>=0&&c.percent<=100?c.percent:null;
 const valid=streamFresh&&market?.live===true&&trade&&active&&percent!==null&&percent>60&&d.confidenceGate?.passed===true&&d.modelAssessment?.passed===true&&d.executionPlan?.valid===true;
 const reason=String(d.reason??'Aucune entrée confirmée');
 const publicReason=reason.includes('expired-entry-window')?friendlyReason(reason):reason.includes('missing-trade-model')?friendlyReason(reason):reason.includes('incompatible-target-model')?'Modèle de trade en observation':reason.includes('insufficient-out-of-sample')?'Validation historique encore insuffisante':reason.includes('unpublished-trade-model')?'Modèle de trade en observation':reason.includes('unvalidated-trade-edge')?'Avantage du modèle non validé':reason.includes('model-source-mismatch')?'Source différente du modèle entraîné':reason;
 return {side:valid?d.side:'HOLD',percent,label:trade?'Objectif avant stop':'Modèle de trade en observation',candidate:d.confidenceGate?.candidateSide??null,reason:!streamFresh?'Connexion aux flux en cours':!trade?'Modèle de trade en observation':publicReason,executable:!!(valid&&state?.profile.confirmed&&market?.eligible&&!state?.account.breached&&!privateRecoveryBlocked(state)&&market.symbol!=='NDX')};
}
export function safeArticle(item:AnyRecord){
 try{const u=new URL(item.url??item.link),at=item.publishedAt??item.publicationTime;if(!['https:','http:'].includes(u.protocol)||!Number.isFinite(Date.parse(at))||typeof (item.title??item.headline)!=='string')return null;return {url:u.href,at,title:item.title??item.headline,source:typeof item.source==='object'?item.source?.name:item.source??item.publisher??'Média'};}catch{return null;}
}
export function privateImport(value:unknown){const v=value as AnyRecord;if(!v||typeof v!=='object'||!v.profile||!Array.isArray(v.positions)||!Array.isArray(v.history)||v.positions.length>10000||v.history.length>10000)throw Error('Archive privée invalide');return v;}
