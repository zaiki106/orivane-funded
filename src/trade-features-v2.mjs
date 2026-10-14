import {strategyRegistry} from './strategy-registry.mjs';

// Only information known at the setup boundary. No labels, exits or future bars.
const alignedIndices=Object.freeze([0,1,2,3,4,5,6,8,11,15,17,18]);
export const tradeFeatureExtensions=Object.freeze([
 ...alignedIndices.map(i=>'sideAligned:'+i),'utcHourSin','utcHourCos','utcWeekSin','utcWeekCos',
 ...strategyRegistry.map(rule=>'strategy:'+rule.id)
]);
export function extendTradeFeatures(base,strategy,entryTimeMs){
 if(!Array.isArray(base)||base.length!==34||!base.every(Number.isFinite)||![-1,1].includes(base[19])||!strategyRegistry.some(rule=>rule.id===strategy)||!Number.isSafeInteger(entryTimeMs)||entryTimeMs%900000!==0)return null;
 const date=new Date(entryTimeMs);if(!Number.isFinite(date.getTime()))return null;
 const hour=(date.getUTCHours()+date.getUTCMinutes()/60)*2*Math.PI/24,week=(date.getUTCDay()+date.getUTCHours()/24+date.getUTCMinutes()/1440)*2*Math.PI/7;
 return [...base,...alignedIndices.map(i=>base[i]*base[19]),Math.sin(hour),Math.cos(hour),Math.sin(week),Math.cos(week),...strategyRegistry.map(rule=>Number(rule.id===strategy))];
}
