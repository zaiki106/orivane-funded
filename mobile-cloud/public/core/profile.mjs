export const marketSymbols=Object.freeze(['BTC/USD','EUR/USD','GBP/USD','XAU/USD','NDX']);
export const defaultProfile={name:'Mon challenge',capital:100000,targetPercent:8,dailyLossPercent:3,totalLossPercent:6,riskPercent:.25,openRiskPercent:.75,minDays:0,resetTimezone:'Africa/Casablanca',allowedSymbols:[...marketSymbols],confirmed:false,deadlineSessions:3};
export function validateProfile(p){
  if(typeof p.name!=='string'||p.name.length>80||!p.name.trim()||!Array.isArray(p.allowedSymbols)||p.allowedSymbols.length>12||p.allowedSymbols.some(s=>!['EUR/USD','GBP/USD','USD/JPY','XAU/USD','BTC/USD','ETH/USD','SPY','QQQ','NDX'].includes(s))||typeof p.confirmed!=='boolean')throw Error('Profil invalide');
  for(const [key,min,max] of [['capital',100,10000000],['targetPercent',.1,50],['dailyLossPercent',.1,20],['totalLossPercent',.1,50],['riskPercent',.01,1],['openRiskPercent',.01,3],['minDays',0,100]])if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw Error('Valeur invalide : '+key);
  if(!Number.isInteger(p.minDays)||p.riskPercent>p.openRiskPercent||p.dailyLossPercent>p.totalLossPercent)throw Error('Limites incohérentes');
  try{new Intl.DateTimeFormat('en',{timeZone:p.resetTimezone}).format();}catch{throw Error('Fuseau invalide');}
  return {...defaultProfile,...p,deadlineSessions:3};
}
