import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([11,19,23,42]),b=a.subarray(1,-1);if(b.buffer!==a.buffer||b.byteOffset!==2||b.join()!=="19,23")throw 1;b[0]=7;if(a[1]!==7)throw 2;const c=new BigInt64Array([19n,23n]);if(c.subarray(-1).join()!=="23")throw 3;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b),tracking=a.subarray(1),fixed=a.subarray(1,3);b.resize(6);if(tracking.length!==5||fixed.length!==2)throw 1;b.resize(2);if(tracking.length!==1||fixed.length!==0)throw 2;b.resize(6);if(fixed.length!==2)throw 3;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b,2,2);b.resize(1);let observed=false;a.constructor={[Symbol.species]:function(buffer,offset,length){if(buffer!==b||offset!==2||length!==0)throw 1;observed=true;return new Uint8Array(0);}};if(a.subarray(0).length!==0||!observed)throw 2;`,
  `const a=new Uint8Array([1,2,3]);let order="";Object.defineProperty(a,"constructor",{get(){order+="c";return undefined;}});a.subarray({valueOf(){order+="s";return 0;}},{valueOf(){order+="e";return 2;}});if(order!=="sec")throw 1;`,
]);
