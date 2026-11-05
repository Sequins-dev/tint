import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Float64Array([NaN,0,-0,10,2,-Infinity,Infinity]);if(a.sort()!==a||a[0]!==-Infinity||1/a[1]!==-Infinity||1/a[2]!==Infinity||a[3]!==2||a[4]!==10||a[5]!==Infinity||a[6]===a[6])throw 1;const b=new BigInt64Array([23n,-19n,2n]);if(b.sort().join()!=="-19,2,23")throw 2;`,
  `const a=new Uint8Array([21,11,22,12]);a.sort((x,y)=>(x%10)-(y%10));if(a.join()!=="21,11,22,12")throw 1;const b=a.toSorted((x,y)=>y-x);if(b.join()!=="22,21,12,11"||a.join()!=="21,11,22,12")throw 2;`,
  `const a=new Uint8Array([3,2,1]);let caught=false;try{a.sort(()=>{throw 42;});}catch(e){caught=e===42;}if(!caught||a.join()!=="3,2,1")throw 1;a.sort(()=>NaN);if(a.join()!=="3,2,1")throw 2;`,
  `const b=new ArrayBuffer(3),a=new Uint8Array(b);a.set([3,2,1]);let count=0;if(a.sort((x,y)=>{if(count++===0)b.transfer();return x-y;})!==a||count===0)throw 1;`,
  `class Derived extends Uint8Array{}const a=new Derived([19,2,23]);Object.defineProperty(a,"constructor",{get(){throw 1;}});const b=a.toSorted();if(b instanceof Derived||!(b instanceof Uint8Array)||b.join()!=="2,19,23"||a.join()!=="19,2,23")throw 2;`,
  `const a=new Uint8Array([2,1]);let count=0;a.sort((x,y)=>({valueOf(){count++;return x-y;}}));if(count===0||a.join()!=="1,2")throw 1;let caught=false;try{a.sort(()=>1n);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;caught=false;try{new Uint8Array(0).toSorted(null);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
]);
