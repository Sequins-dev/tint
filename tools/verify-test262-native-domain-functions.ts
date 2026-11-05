import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const f=new Function('value','return value');if(f(19)!==19||f(42)!==42)throw 1;`,
  `globalThis.domainValue=19;const f=new Function('return domainValue');if(f()!==19)throw 1;globalThis.domainValue=42;if(f()!==42)throw 2;`,
  `const f=new Function('this.touched=true;return this;'),object={};if(f.call(object)!==object||object.touched!==true)throw 1;object.touched=false;if(f.call(object)!==object||object.touched!==true)throw 2;`,
]);
