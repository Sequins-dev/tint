import {readFileSync} from 'node:fs';
import {compareCollation} from '../../packages/js-runtime/src/objects/collation-engine.ts';
const options={sensitivity:'variant',caseFirst:'false',numeric:false,ignorePunctuation:false};
const compare=(a,b)=>compareCollation(a,b,options);const key=()=>undefined;
const rows=readFileSync('.tint-bootstrap/j-collation-inputs/CollationTest-root17.txt','utf8').split('\n').map(x=>x.split('#')[0].trim()).filter(x=>x&&!x.startsWith('@')).map(x=>String.fromCodePoint(...x.split(/\s+/).map(p=>parseInt(p,16))));
let bad=0;const failures=[];console.log(new Date().toISOString(),'checking',rows.length,'ordered corpus rows');
for(let i=1;i<rows.length;i++){if(compare(rows[i-1],rows[i])>0){bad++;if(failures.length<8)failures.push({i,left:Array.from(rows[i-1],x=>x.codePointAt(0).toString(16)),right:Array.from(rows[i],x=>x.codePointAt(0).toString(16)),leftKey:key(rows[i-1]),rightKey:key(rows[i])});}if(i%10000===0)console.log(new Date().toISOString(),'checked',i,'inversions',bad);}
console.log(JSON.stringify({rows:rows.length,bad,failures},null,2));process.exitCode=bad?1:0;
