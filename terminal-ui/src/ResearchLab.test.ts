import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ResearchLabReport,validResearchReport} from './ResearchLab';
const stress=[1,1.5,2].map(costMultiplier=>({costMultiplier,n:100,target:40,stop:40,expired:20,netExpectancyR:-.2,targetRate:.4}));
const report={schemaVersion:1,kind:'independent-strategy-lab',synthetic:false,symbol:'BTC/USD',source:'Controlled UI test fixture',strategies:1,policyVariants:2,fromMs:1000,throughMs:2000,developmentBoundaryMs:3000,optimizer:{trials:6},policy:{usesFinalTest:false,promotesPaper:false,empiricalRatesAreConfidence:false},folds:[{},{},{}],results:['align-if-available','context-only'].map(h1Policy=>({id:'example',name:'Example research recipe',h1Policy,stress}))};
it('independent research renders observed outcomes and losses without an order control',()=>{
 expect(validResearchReport(report)).toBe(true);
 const html=renderToStaticMarkup(createElement(ResearchLabReport,{report}));
 expect(html).toContain('TP observés 40');expect(html).toContain('0,200');
 expect(html).toContain('ne sont pas une confiance prédictive');expect(html).not.toContain('Ouvrir');
});
it('research rejects synthetic results, final-test selection and incomplete cost metrics',()=>{
 expect(validResearchReport({...report,synthetic:true})).toBe(false);
 expect(validResearchReport({...report,policy:{...report.policy,usesFinalTest:true}})).toBe(false);
 expect(validResearchReport({...report,results:[report.results[0]]})).toBe(false);
 expect(validResearchReport({...report,optimizer:undefined})).toBe(false);
 expect(validResearchReport({...report,results:report.results.map(r=>({...r,stress:[stress[0],stress[0],stress[2]]}))})).toBe(false);
});
