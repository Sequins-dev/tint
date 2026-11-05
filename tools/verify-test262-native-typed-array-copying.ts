import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([19,23,42]);const b=a.toReversed();if(b===a||!(b instanceof Uint16Array)||b.join()!=="42,23,19"||a.join()!=="19,23,42")throw 1;const c=new BigInt64Array([19n,-23n]).toReversed();if(c.join()!=="-23,19")throw 2;`,
  `class Derived extends Uint8Array{}const a=new Derived([19,23]);Object.defineProperty(a,"constructor",{get(){throw 1;}});Object.defineProperty(a,"length",{get(){throw 2;}});const b=a.toReversed();if(b instanceof Derived||!(b instanceof Uint8Array)||b.join()!=="23,19")throw 3;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b,2,2);b.resize(2);let caught=false;try{a.toReversed();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;b.resize(4);a[0]=19;a[1]=23;if(a.toReversed().join()!=="23,19")throw 2;`,
  `const a=new Float64Array([-0,NaN,Infinity]),b=a.toReversed();if(b[0]!==Infinity||b[1]===b[1]||1/b[2]!==-Infinity)throw 1;const c=new Uint8Array(0);if(c.toReversed()===c)throw 2;`,
]);
