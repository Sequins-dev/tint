import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `const GeneratorFunction=Object.getPrototypeOf(function*(){}).constructor;const f=GeneratorFunction("value","return value;");if(f.length!==1||f.name!=="anonymous"||Object.getPrototypeOf(f)!==GeneratorFunction.prototype)throw 1;const value={},g=f(value),first=g.next();if(first.value!==value||!first.done||!g.next().done||g.next().value!==undefined||g[Symbol.iterator]()!==g)throw 2;const returned=f(42).return(19);if(returned.value!==19||!returned.done)throw 3;let caught;try{f(42).throw(value);}catch(e){caught=e;}if(caught!==value)throw 4;let construct=false;try{new f();}catch(e){construct=e instanceof TypeError;}if(!construct)throw 5;`,
  `const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const f=AsyncFunction("value","return value;");if(f.length!==1||f.name!=="anonymous"||Object.getPrototypeOf(f)!==AsyncFunction.prototype||f.hasOwnProperty("prototype"))throw 1;const input=Promise.resolve(42),result=f(input);if(!(result instanceof Promise)||result===input||await result!==42)throw 2;let called=0;const adopted=f({then(resolve){called++;resolve(19);}});if(called!==0||await adopted!==19||called!==1)throw 3;const marker={};let caught;try{await f({get then(){throw marker;}});}catch(e){caught=e;}if(caught!==marker)throw 4;let construct=false;try{new f();}catch(e){construct=e instanceof TypeError;}if(!construct)throw 5;`,
  `const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,GeneratorFunction=Object.getPrototypeOf(function*(){}).constructor;for(const C of [AsyncFunction,GeneratorFunction]){const f=C("return this;"),strict=C("'use strict';return this;");if(C===AsyncFunction){if(await f()!==globalThis||await strict.call(null)!==null)throw 1;}else{if(f().next().value!==globalThis||strict.call(null).next().value!==null)throw 2;}}`,
  `const other=$262.createRealm().global,target=other.Function("return this;");target.prototype=null;const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,GeneratorFunction=Object.getPrototypeOf(function*(){}).constructor;for(const C of [AsyncFunction,GeneratorFunction]){const f=Reflect.construct(C,["return this;"],target),prototype=Object.getPrototypeOf(f);if(prototype===C.prototype||Object.getPrototypeOf(prototype)!==other.Function.prototype)throw 1;if(C===AsyncFunction){if(await f()!==globalThis)throw 2;}else if(f().next().value!==globalThis)throw 3;}`,
];
verifyNativeScriptCases(
  sources.map(
    (source) =>
      `(async()=>{${source}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:dynamic-kind"));`,
  ),
  { nodeReference: false, asynchronous: true },
);
