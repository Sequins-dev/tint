import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([11,19,23,42]),b=a.slice(1,-1);if(b.buffer===a.buffer||b.join()!=="19,23")throw 1;b[0]=7;if(a[1]!==19)throw 2;const c=new BigInt64Array([19n,23n]);if(c.slice(-1).join()!=="23")throw 3;`,
  `const a=new Uint8Array([1,2,3,4]);a.constructor={[Symbol.species]:function(n){return new Uint8Array(a.buffer,1,n);}};if(a.slice(0,3).join()!=="1,1,1"||a.join()!=="1,1,1,1")throw 1;`,
  `const b=new ArrayBuffer(8),bytes=new Uint8Array(b),a=new Float64Array(b);bytes[0]=17;bytes[6]=248;bytes[7]=127;const copied=new Uint8Array(a.slice().buffer);for(let i=0;i<8;i++)if(copied[i]!==bytes[i])throw 1;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);a.set([1,2,3,4]);a.constructor={[Symbol.species]:function(n){b.resize(2);return new Uint8Array(n);}};if(a.slice(1,4).join()!=="2,0,0")throw 1;`,
  `const a=new Uint16Array([259,260]);a.constructor={[Symbol.species]:Uint8Array};if(a.slice().join()!=="3,4")throw 1;`,
  `const b=new ArrayBuffer(2),a=new Uint8Array(b);const result=a.slice({valueOf(){b.transfer();return 0;}},0);if(result.length!==0)throw 1;const c=new ArrayBuffer(2),d=new Uint8Array(c);let caught=false;try{d.slice({valueOf(){c.transfer();return 0;}},1);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
  `const a=new Uint8Array([1,2]);let order="";Object.defineProperty(a,"constructor",{get(){order+="c";return undefined;}});a.slice({valueOf(){order+="s";return 0;}},{valueOf(){order+="e";return 1;}});if(order!=="sec")throw 1;`,
]);
