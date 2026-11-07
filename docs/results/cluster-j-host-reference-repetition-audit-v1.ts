import {compileRegExp,executeRegExp} from '../packages/foundation/src/regexp/engine/index.ts';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const atoms=['a','[ab]','[^b]','.',String.raw`\w`,'(?:a)','(?i:a)','😀'];
const quantifiers=['*','+','{0,0}','{0,2}','{1,3}','{2,}'];
const patterns=new Set<string>();
for(const a of atoms)for(const q of quantifiers)for(const suffix of ['a','b','$',String.raw`\1`])for(const wrap of [`(${a}${q})${suffix}`,`(?<=(${a}${q}))${suffix}`,`(?:(${a}${q})|b)+${suffix}`,`(${a}${q})a?${suffix}`])patterns.add(wrap);
const inputs=['','a','b','ab','aaa','aab','aba','bbb','baaaa','AaaAb','😀😀','😀a😀','\ud83d😀\ude00','\n\r','aa\nb'];
let checks=0;
for(const pattern of patterns)for(const flags of ['', 'u','i','iu']){
 let expected:RegExp;try{expected=new RegExp(pattern,flags)}catch{continue}
 const compiled=compileRegExp(pattern,flags);assert.ok(compiled.ok,pattern);if(!compiled.ok)continue;
 for(const input of inputs){const e=expected.exec(input),a=executeRegExp(compiled.value,input);const normalized=a.kind==='match'?{start:a.match.start,end:a.match.end,captures:a.match.captures.map(x=>x===undefined?undefined:input.slice(x.start,x.end))}:a.kind;
 assert.deepEqual(normalized,e?{start:e.index,end:e.index+e[0].length,captures:[...e]}:'no-match',JSON.stringify({pattern,flags,input}));checks++}
}
const report={kind:'cluster-j-host-reference-repetition-audit',at:new Date().toISOString(),native:false,conformance:false,patterns:patterns.size,checks,mismatches:0,note:'Deterministic host comparison of greedy repetitions, captures, lookbehind, nested alternatives, Unicode boundaries and backreferences. Does not replace native fixtures or Test262 reports.'};
writeFileSync('.tint-bootstrap/j-auth-hold-repetition-audit-v1.json',JSON.stringify(report,null,2)+'\n');console.log(report);
