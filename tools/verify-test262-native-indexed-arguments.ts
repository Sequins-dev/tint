import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `const f=Function("return arguments[0];");for(const value of [undefined,null,false,42,"text",{},Symbol(),0n]){if(f(value)!==value)throw 1;}if(f.length!==0)throw 2;`,
  `const f=Function("a","a","return arguments[0];"),g=Function("a","a","return arguments[1];");if(f(17,29)!==17||g(17,29)!==29)throw 1;const h=Function("a","return arguments[0]===a;");if(!h({}))throw 2;`,
  `const f=Function("a","'use strict';return arguments[1];");if(f(17,29)!==29||f.length!==1)throw 1;Object.prototype[0]=99;try{if(Function("return arguments[0];")(undefined)!==undefined)throw 2;}finally{delete Object.prototype[0];}`,
  `const G=(function*(){}).constructor,A=(async function(){}).constructor,AG=(async function*(){}).constructor;const value={};const result=G("return arguments[0];")(value).next();if(!result.done||result.value!==value)throw 1;if(await A("return arguments[0];")(value)!==value)throw 2;const r=await AG("return arguments[0];")(value).next();if(!r.done||r.value!==value)throw 3;`,
  // Deliberately unsupported: absence must not silently ignore inherited getters.
  `Object.prototype[0]=42;Function("return arguments[0];")();`,
];
verifyNativeScriptCases(
  sources.map(
    (source) =>
      `(async()=>{${source}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:indexed-arguments"));`,
  ),
  { nodeReference: false, asynchronous: true },
);
