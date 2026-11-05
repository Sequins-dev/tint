import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ES2025 23.2.3.30 passes two arguments when the result retains length tracking.
// Node 24.12 passes an explicit third undefined argument instead.
verifyNativeScriptCases(
  [
    `const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);let observed="";a.constructor={[Symbol.species]:function(buffer,offset,length){observed=arguments.length+":"+offset+":"+length;if(buffer!==b)throw 1;return new Uint8Array(0);}};a.subarray(1);if(observed!=="2:1:undefined")throw 2;a.subarray(1,3);if(observed!=="3:1:2")throw 3;`,
  ],
  { nodeReference: false },
);
