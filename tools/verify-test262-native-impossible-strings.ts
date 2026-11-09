import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// A string longer than the maximum length can never be allocated. Each case
// requests one (2^32 code units) without first building anything near that
// size, catches the RangeError, and then allocates normally again.
verifyNativeScriptCases([
  String.raw`const chunk="x".repeat(1<<20),parts=[];for(let i=0;i<4096;i++)parts.push(chunk);let caught=false;try{parts.join("");}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;if(parts.slice(0,3).join("").length!==3<<20)throw 2;`,
  String.raw`const input="x".repeat(1<<20);let caught=false;try{input.replace(/(x+)/,"$1".repeat(4096));}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;if(input.replace(/(x+)/,"$1$1").length!==2<<20)throw 2;`,
  String.raw`const chunk="y".repeat(1<<20),parts=[];for(let i=0;i<4096;i++)parts.push(chunk);let first,second;try{parts.join("");}catch(e){first=e;}try{parts.join("");}catch(e){second=e;}if(!(first instanceof RangeError)||!(second instanceof RangeError)||first===second)throw 1;`,
]);
