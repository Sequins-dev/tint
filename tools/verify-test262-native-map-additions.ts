import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// The pinned suite includes upsert methods absent from Node 24's Map prototype.
verifyNativeScriptCases(
  [
    `const map=new Map([[1,undefined]]);if(map.getOrInsert(1,42)!==undefined||map.get(1)!==undefined||map.getOrInsert(2,42)!==42||map.get(2)!==42)throw 1;map.getOrInsert(-0,19);if(map.getOrInsert(0,23)!==19||1/map.keys().toArray()[2]!==Infinity)throw 2;`,
    `const map=new Map();let count=0;const value=map.getOrInsertComputed(-0,function(key){"use strict";if(this!==undefined||arguments.length!==1||1/key!==Infinity)throw 1;count++;map.set(key,19);return 42;});if(value!==42||map.get(0)!==42||map.size!==1||count!==1||map.getOrInsertComputed(0,()=>{throw 2;})!==42)throw 3;let caught=false;try{map.getOrInsertComputed(0,null);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 4;`,
    `const map=new Map();const marker={};let caught;try{map.getOrInsertComputed(1,()=>{map.set(2,23);throw marker;});}catch(e){caught=e;}if(caught!==marker||map.has(1)||map.get(2)!==23)throw 1;map.set(1,19);if(map.getOrInsertComputed(3,()=>{map.clear();map.set(3,19);map.set(4,23);return 42;})!==42||map.get(3)!==42||map.keys().toArray().join()!=="3,4")throw 2;`,
    `const a={},b={};let count=0;const map=Map.groupBy.call(null,[a,b,a],function(value,index){"use strict";if(this!==undefined||arguments.length!==2||index!==count++)throw 1;return value;});if(!(map instanceof Map)||map.size!==2||map.get(a).length!==2||map.get(b)[0]!==b||map.keys().next().value!==a)throw 2;const ints=Map.groupBy([1,2,3],v=>BigInt(v%2));if(ints.size!==2||ints.get(1n).join()!=="1,3"||ints.get(0n)[0]!==2)throw 3;`,
    `const map=Map.groupBy([-0,0,NaN,NaN],v=>v);const keys=map.keys().toArray();if(map.size!==2||map.get(0).length!==2||map.get(NaN).length!==2||1/keys[0]!==Infinity)throw 1;const groups=Object.groupBy([19,23],()=>"__proto__");if(Object.getPrototypeOf(groups)!==null||groups.__proto__.join()!=="19,23")throw 2;`,
    `const marker={};let closed=0;const source={ [Symbol.iterator](){return {next(){return {value:1,done:false};},return(){closed++;throw 2;}};}};let caught;try{Map.groupBy(source,()=>{throw marker;});}catch(e){caught=e;}if(caught!==marker||closed!==1)throw 1;let touched=0;try{Map.groupBy({get [Symbol.iterator](){touched++;throw 3;}},null);}catch(e){if(!(e instanceof TypeError))throw 4;}if(touched!==0)throw 5;`,
  ],
  { nodeReference: false },
);
