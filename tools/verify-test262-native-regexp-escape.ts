import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const samples = Array.from({ length: 128 }, (_, code) =>
  String.fromCharCode(code),
);
samples.push(
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2028",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
  "\ud800",
  "\udc00",
  "\ud83d\ude00",
  "a-b/c",
  "_\ud800\ud800\udc00\udc00",
);
verifyNativeScriptCases([
  `const inputs=${JSON.stringify(samples)},expected=${JSON.stringify(samples.map((text) => RegExp.escape(text)))};for(let i=0;i<inputs.length;i++)if(RegExp.escape(inputs[i])!==expected[i])throw i;`,
  `let converted=false;for(const value of [undefined,null,true,42,1n,Symbol(),{},new String("x"),{toString(){converted=true;return "x";}}]){try{RegExp.escape(value);throw 1;}catch(e){if(!(e instanceof TypeError))throw 2;}}if(converted)throw 3;`,
]);
