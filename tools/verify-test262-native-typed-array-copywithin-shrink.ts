import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// The living specification corrects ES2025 copyWithin to copy the longest
// still-valid prefix after coercion shrinks a tracking view.
verifyNativeScriptCases([
  `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);a.set([1,2,3,4]);a.copyWithin(1,{valueOf(){b.resize(3);return 0;}},3);if(a.join()!=="1,1,2")throw 1;`,
]);
