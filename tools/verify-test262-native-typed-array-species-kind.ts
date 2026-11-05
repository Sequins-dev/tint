import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ES2025 23.2.4.1 step 5 requires the same content type even for empty results.
// Node 24.12 does not reject these empty cross-content-type species results.
verifyNativeScriptCases(
  [
    `const a=new Uint8Array(0);a.constructor={[Symbol.species]:BigInt64Array};let caught=false;try{a.map(v=>v);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;caught=false;try{a.filter(()=>true);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;const b=new BigInt64Array([19n,23n]);if(b.map(v=>v+1n).join()!=="20,24"||b.filter(v=>v>20n).join()!=="23")throw 3;`,
  ],
  { nodeReference: false },
);
