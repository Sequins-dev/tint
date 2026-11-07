import {compareCollation} from '../../packages/js-runtime/src/objects/collation-engine.ts';
const strings=['','a','A','ae','AE','ä','Ä','ab','af','o','oe','ö','Ö','ü','Ü','u','ue','Ue','z','å','Å','æ','ø','œ','ô','ñ','n','N','na','nz','c','ch','cha','d','w','v','y','Y','þ','TH','Th','th','ƿ','Ƿ','ʒ','Ʒ','9','a9','a1','1a','a0','a','a\u0308','a\u0301','á','à','ă','ā','ạ','ᷓ','o\u0308\u0323','ö\u0323','เ','ก','เก','แก','ฯ','๚','ๆ','๛','\u0640','\u0647','\ufeeb','\ufeea','\u1100','\u11a8','\u1100\u1100','\u1101','\u11a9'];
const profiles=[['root/search','en',{usage:'search'}],['root/eor','en-u-co-eor',{}],['de/phonebk','de-u-co-phonebk',{}],['de/search','de',{usage:'search'}],['root/eor','de-u-co-eor',{}],['es/standard','es',{}],['es/search','es',{usage:'search'}],['sv/standard','sv',{}],['th/standard','th',{}]] as const;
let count=0,bad=0;const failures:unknown[]=[];const totals=[];
for(const [profile,locale,usage] of profiles){let localBad=0;
 for(const sensitivity of ['base','accent','case','variant'] as const){const ref=new Intl.Collator(locale,{...usage,sensitivity}),options={sensitivity,caseFirst:'false',numeric:false,ignorePunctuation:ref.resolvedOptions().ignorePunctuation,profile} as const;
 for(const a of strings)for(const b of strings){const expected=Math.sign(ref.compare(a,b)),actual=compareCollation(a,b,options);count++;if(actual!==expected){localBad++;bad++;if(failures.length<20)failures.push({a,b,locale,profile,sensitivity,actual,expected});}}
 }totals.push({profile,bad:localBad});console.log(profile,'failures',localBad);
}console.log(JSON.stringify({count,bad,totals,failures},null,2));process.exitCode=bad?1:0;
