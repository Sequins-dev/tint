import {compileRegExp,executeRegExp} from '../packages/foundation/src/regexp/engine/index.ts';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const atoms=[String.raw`\p{RGI_Emoji}`,String.raw`\p{Basic_Emoji}`,String.raw`[\q{ab|a|}]`,String.raw`[\q{a|ab}]`,String.raw`[\p{RGI_Emoji}\q{a|ab}]`,String.raw`[\p{RGI_Emoji}--\p{Basic_Emoji}]`];
const suffixes=['a','$','😀',String.raw`\1`];
const inputs=['','a','ab','aa','aba','abab','baab','😀','😀😀','👩','👩‍💻','👩‍💻😀','👩‍💻👩‍💻a','a👩‍💻','👍🏽','1️⃣','\ud83d','\ud83d😀\ude00'];
let checks=0,patterns=0;
for(const atom of atoms)for(const q of ['*','+','{0,2}','{1,3}','*?','+?'])for(const suffix of suffixes)for(const pattern of [`(${atom}${q})${suffix}`,`(?<=(${atom}${q}))${suffix}`,`(?:(${atom}${q})|a)+${suffix}`])for(const flags of ['v','vi']){
 const reference=new RegExp(pattern,flags),compiled=compileRegExp(pattern,flags);assert.ok(compiled.ok,pattern);if(!compiled.ok)continue;patterns++;
 for(const input of inputs){const e=reference.exec(input),a=executeRegExp(compiled.value,input);assert.deepEqual(a.kind==='match'?{start:a.match.start,end:a.match.end,captures:a.match.captures.map(c=>c===undefined?undefined:input.slice(c.start,c.end))}:a.kind,e?{start:e.index,end:e.index+e[0].length,captures:[...e]}:'no-match',JSON.stringify({pattern,flags,input}));checks++}
}
const r={kind:'cluster-j-string-property-backtracking-host-audit',at:new Date().toISOString(),conformance:false,native:false,patterns,checks,mismatches:0,note:'Known long-established emoji inputs only, avoiding Unicode version differences. Host comparison of variable-width/empty strings, repetition, suffix backtracking, lookbehind, nested alternatives and captures; not native evidence.'};writeFileSync('.tint-bootstrap/j-string-property-backtracking-audit-v2.json',JSON.stringify(r,null,2)+'\n');console.log(r);
