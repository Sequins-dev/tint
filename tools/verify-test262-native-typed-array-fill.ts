import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint8Array([1,2,3,4]);if(a.fill(259,-3,-1)!==a||a.join()!=="1,3,3,4")throw 1;const b=new BigInt64Array(2);b.fill(true);if(b[0]!==1n||b[1]!==1n)throw 2;`,
  `const a=new Uint8Array(3);let order="";a.fill({valueOf(){order+="v";return 19;}},{valueOf(){order+="s";return 1;}},{valueOf(){order+="e";return 3;}});if(order!=="vse"||a.join()!=="0,19,19")throw 1;let calls=0;new Uint8Array(0).fill({valueOf(){calls++;return 1;}});if(calls!==1)throw 2;`,
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);a.fill(23,{valueOf(){b.resize(2);return 0;}});if(a.join()!=="23,23")throw 1;a.fill(19,{valueOf(){b.resize(6);return 0;}});if(a.join()!=="19,19,0,0,0,0")throw 2;`,
  `const b=new ArrayBuffer(2),a=new Uint8Array(b);let order="",caught=false;try{a.fill({valueOf(){b.transfer();order+="v";return 1;}},{valueOf(){order+="s";return 0;}},{valueOf(){order+="e";return 0;}});}catch(e){caught=e instanceof TypeError;}if(!caught||order!=="vse")throw 1;`,
  `const a=new BigInt64Array(0);let caught=false;try{a.fill(1);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;caught=false;try{Uint8Array.prototype.fill.call({length:0},1);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
]);
