import {compareCollation} from '../../packages/js-runtime/src/objects/collation-engine.ts';
const strings=['','a','A','á','Á','aá','aÁ','ä','æ','Æ','b','B','ａ','Ａ','ᵃ','2','02','10','٢','２','*','-',' ','.','$','a-\u0301','a\u0301','ab','a b','áa','aA','Aa','áÁ','Aã','\u0301','\u0345','\u1fbe'];
let count=0,bad=0;const failures=[];
for(const sensitivity of ['base','accent','case','variant'] as const)for(const caseFirst of ['false','lower','upper'] as const)for(const numeric of [false,true])for(const ignorePunctuation of [false,true]){
 const options={sensitivity,caseFirst,numeric,ignorePunctuation},ref=new Intl.Collator('en',options);
 for(const a of strings)for(const b of strings){const expected=Math.sign(ref.compare(a,b)),actual=compareCollation(a,b,options);count++;if(actual!==expected){bad++;if(failures.length<12)failures.push({a,b,options,actual,expected});}}
}console.log(JSON.stringify({count,bad,failures},null,2));process.exitCode=bad?1:0;
