import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  "const a=new Uint8Array([19,23]);if(a.values!==a[Symbol.iterator])throw 1;const values=a.values();if(values.next().value!==19||values.next().value!==23||!values.next().done)throw 2;const keys=a.keys();if(keys.next().value!==0||keys.next().value!==1||!keys.next().done)throw 3;const entry=a.entries().next().value;if(entry[0]!==0||entry[1]!==19)throw 4;",
  'const a=new Uint8Array([19]);Object.defineProperty(a,"length",{get(){throw 1;}});const it=Array.prototype.values.call(a);if(it.next().value!==19||!it.next().done)throw 2;let caught=false;try{Uint8Array.prototype.values.call({length:1,0:19});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;',
]);
