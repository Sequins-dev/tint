import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `const holder={value:Function("return 'a\\\\0\\\\ud800';")()};let checksum=0;for(let i=0;i<10;i++){const bytes=new Uint8Array(8*1024*1024);bytes[0]=i;checksum+=bytes[0];}if(checksum!==45||holder.value.length!==3||holder.value.charCodeAt(0)!==97||holder.value.charCodeAt(1)!==0||holder.value.charCodeAt(2)!==0xd800)throw 1;`,
  `const f=Function("return '😀literal';");if(f()!=="😀literal"||f()!==f())throw 1;const GeneratorFunction=(function*(){}).constructor,g=GeneratorFunction("return 'generator';")().next();if(!g.done||g.value!=="generator")throw 2;const AsyncFunction=(async function(){}).constructor;if(await AsyncFunction("return 'async';")()!=="async")throw 3;const AsyncGeneratorFunction=(async function*(){}).constructor,a=await AsyncGeneratorFunction("return 'async-generator';")().next();if(!a.done||a.value!=="async-generator")throw 4;`,
];
verifyNativeScriptCases(
  sources.map(
    (source) =>
      `(async()=>{${source}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:code-literals"));`,
  ),
  { nodeReference: false, asynchronous: true },
);
