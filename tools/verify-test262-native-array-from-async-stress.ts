import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`Array.fromAsync({length:4096},async(_,i)=>i).then(a=>{if(a.length!==4096)throw 1;for(let i=0;i<a.length;i++){if(a[i]!==i)throw 2;}}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:Test262Error:"+String(e)));`,
  ],
  { asynchronous: true, nodeReference: false },
);
