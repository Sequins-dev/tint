import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint8Array([19,23]);if(a.join()!=="19,23"||a.join(":")!=="19:23"||a.toString()!=="19,23"||Uint8Array.prototype.toString!==Array.prototype.toString)throw 1;const b=new BigInt64Array([19n,-1n]);if(b.join("/")!=="19/-1")throw 2;`,
  `const b=new ArrayBuffer(3,{maxByteLength:6}),a=new Uint8Array(b);const separator={toString(){b.resize(0);return ":";}};if(a.join(separator)!=="::")throw 1;`,
  `const a=new Uint8Array(0);let count=0;if(a.join({toString(){count++;return ":";}})!==""||count!==1)throw 1;let caught=false;try{Uint8Array.prototype.join.call({length:0});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
]);
