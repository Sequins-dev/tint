import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint8Array([1,2,3]);if(a.with(-1,259).join()!=="1,2,3"||a.with(-0,19).join()!=="19,2,3"||a.with(NaN,23).join()!=="23,2,3"||a.join()!=="1,2,3")throw 1;const b=new BigInt64Array([19n,23n]);if(b.with(0,true).join()!=="1,23")throw 2;`,
  `const a=new Uint8Array([1]);let order="",caught=false;try{a.with({valueOf(){order+="i";return 4;}},{valueOf(){order+="v";return 19;}});}catch(e){caught=e instanceof RangeError;}if(!caught||order!=="iv")throw 1;`,
  `const b=new ArrayBuffer(3,{maxByteLength:6}),a=new Uint8Array(b);a.set([1,2,3]);const result=a.with({valueOf(){b.resize(6);return 4;}},19);if(result.join()!=="1,2,3")throw 1;`,
  `const b=new ArrayBuffer(3,{maxByteLength:6}),a=new Uint8Array(b);a.set([1,2,3]);const result=a.with(0,{valueOf(){b.resize(1);return 19;}});if(result.join()!=="19,0,0")throw 1;`,
  `const b=new ArrayBuffer(2),a=new Uint8Array(b);let caught=false;try{a.with(0,{valueOf(){b.transfer();return 19;}});}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;`,
  `class Derived extends Uint8Array{}const a=new Derived([1,2]);Object.defineProperty(a,"constructor",{get(){throw 1;}});const b=a.with(1,19);if(b instanceof Derived||!(b instanceof Uint8Array)||b.join()!=="1,19")throw 2;`,
]);
