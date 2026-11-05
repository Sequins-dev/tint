import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Float64Array([19,NaN,-0,19]);if(a.at(-1)!==19||a.at(-5)!==undefined||!a.includes(NaN)||a.indexOf(NaN)!==-1||a.indexOf(0)!==2||a.lastIndexOf(19)!==3||a.lastIndexOf(19,undefined)!==0||a.indexOf(19,-1)!==3)throw 1;`,
  `const a=new BigInt64Array([19n,23n,19n]);if(!a.includes(19n)||a.includes(19)||a.indexOf(23n)!==1||a.lastIndexOf(19n)!==2)throw 1;Object.defineProperty(a,"length",{get(){throw 2;}});if(a.at(-1)!==19n||a.indexOf(19n)!==0)throw 3;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);const from={valueOf(){b.resize(0);return 0;}};if(!a.includes(undefined,from))throw 1;b.resize(4);if(a.indexOf(undefined,from)!==-1)throw 2;b.resize(4);if(a.at(from)!==undefined)throw 3;`,
  `let count=0;const from={valueOf(){count++;return 0;}};const a=new Uint8Array(0);if(a.includes(1,from)||a.indexOf(1,from)!==-1||a.lastIndexOf(1,from)!==-1||count!==0)throw 1;if(a.at(from)!==undefined||count!==1)throw 2;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b,0,4);b.resize(0);let count=0,caught=false;try{a.indexOf(0,{valueOf(){count++;return 0;}});}catch(e){caught=e instanceof TypeError;}if(!caught||count!==0)throw 1;`,
]);
