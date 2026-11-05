import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([1,2,3]);if(a.reverse()!==a||a[0]!==3||a[1]!==2||a[2]!==1)throw 1;const b=new BigInt64Array([19n,-23n]);b.reverse();if(b[0]!==-23n||b[1]!==19n)throw 2;const c=new Float64Array([-0,Infinity]);c.reverse();if(c[0]!==Infinity||1/c[1]!==-Infinity)throw 3;`,
  `const b=new ArrayBuffer(8),a=new Uint16Array(b),v=new Uint16Array(b,2,2);a[0]=11;a[1]=19;a[2]=23;a[3]=42;Object.defineProperty(v,"length",{get(){throw 1;}});v.reverse();if(a[0]!==11||a[1]!==23||a[2]!==19||a[3]!==42)throw 2;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b,2,2);b.resize(2);let caught=false;try{a.reverse();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;b.resize(4);a[0]=19;a[1]=23;a.reverse();if(a[0]!==23||a[1]!==19)throw 2;b.transfer();caught=false;try{a.reverse();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  `let caught=false;try{Uint8Array.prototype.reverse.call([]);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;const a=new Uint8Array(0);if(a.reverse()!==a)throw 2;`,
]);
