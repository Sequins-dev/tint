import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases([
  `var first=new Uint8Array(new SharedArrayBuffer(4));first[0]=42;
for(var i=1;i<1120;i++)new SharedArrayBuffer(4);
if(first[0]!==42)throw new Error("shared block reclaimed while live");`,
]);
