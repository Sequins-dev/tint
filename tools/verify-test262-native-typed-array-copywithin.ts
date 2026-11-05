import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([1,2,3,4]);if(a.copyWithin(1,0,3)!==a||a.join()!=="1,1,2,3")throw 1;a.copyWithin(0,1);if(a.join()!=="1,2,3,3")throw 2;const b=new BigInt64Array([1n,2n,3n]);b.copyWithin(-2,-1);if(b.join()!=="1,3,3")throw 3;`,
  `const b=new ArrayBuffer(16),bytes=new Uint8Array(b),v=new Float64Array(b);bytes[0]=17;bytes[6]=248;bytes[7]=127;v.copyWithin(1,0,1);for(let i=0;i<8;i++)if(bytes[i]!==bytes[i+8])throw 1;`,
  `const a=new Uint8Array([1,2,3,4]);let order="";a.copyWithin({valueOf(){order+="t";return 1;}},{valueOf(){order+="s";return 0;}},{valueOf(){order+="e";return 2;}});if(order!=="tse"||a.join()!=="1,1,2,4")throw 1;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);a.set([1,2,3,4]);a.copyWithin(0,{valueOf(){b.resize(3);return 1;}},4);if(a.join()!=="2,3,3")throw 1;`,
  `const b=new ArrayBuffer(2),a=new Uint8Array(b);a.copyWithin({valueOf(){b.transfer();return 2;}},0,0);const c=new ArrayBuffer(2),v=new Uint8Array(c);let caught=false;try{v.copyWithin({valueOf(){c.transfer();return 0;}},1);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;`,
]);
