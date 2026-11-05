import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `if('\\uFEFF\\u2028 ab \\u2029'.trim()!=='ab'||' x '.trimStart()!=='x '||' x '.trimEnd()!==' x'||String.prototype.trimLeft!==String.prototype.trimStart||String.prototype.trimRight!==String.prototype.trimEnd)throw 1;`,
  `if(!'A😀Z'.startsWith('\\uD83D',1)||!'A😀Z'.endsWith('\\uDE00',3)||!'A😀Z'.includes('\\uD83D')||'abc'.startsWith('a',Infinity)||!'abc'.endsWith('',NaN))throw 1;`,
  `let log='';const receiver={toString(){log+='r';return 'abc';}},search={get [Symbol.match](){log+='m';return false;},toString(){log+='s';return 'b';}},position={valueOf(){log+='p';return 1;}};if(!String.prototype.startsWith.call(receiver,search,position)||log!=='rmsp')throw 1;let caught=0;for(const name of ['startsWith','endsWith','includes']){try{String.prototype[name].call('abc',/a/,position);}catch(e){if(e instanceof TypeError)caught++;}}if(caught!==3||log!=='rmsp')throw 2;`,
  `if('ab'.repeat(3)!=='ababab'||'x'.repeat(-0.5)!==''||'x'.repeat(NaN)!=='')throw 1;let caught=0;for(const count of [-1,Infinity,1e30]){try{'x'.repeat(count);}catch(e){if(e instanceof RangeError)caught++;}}if(caught!==3)throw 2;let log='';const receiver={toString(){log+='r';return 'x';}},arg={toString(){log+='a';return 'y';}};if(String.prototype.concat.call(receiver,arg,3)!=='xy3'||log!=='ra')throw 3;`,
];
verifyNativeScriptCases(sources);
