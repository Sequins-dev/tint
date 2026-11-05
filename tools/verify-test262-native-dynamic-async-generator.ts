import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `const AsyncGeneratorFunction=(async function*(){}).constructor;for(const args of [["await 1;"],["x","yield x;"],["{x}","y=1","...rest","yield missingGlobal;"]]){const f=AsyncGeneratorFunction(...args);if(f.name!=="anonymous"||Object.getPrototypeOf(f)!==AsyncGeneratorFunction.prototype||!f.hasOwnProperty("prototype"))throw 1;}if(AsyncGeneratorFunction("{x}","y=1","yield 1;").length!==1)throw 2;`,
  `const AsyncGeneratorFunction=(async function*(){}).constructor,f=AsyncGeneratorFunction("value","yield value;");let count=0;const input={then(resolve){count++;resolve(42);}},g=f(19);if(g[Symbol.asyncIterator]()!==g||count!==0)throw 1;const pending=g.return(input);if(count!==0)throw 2;const result=await pending;if(result.value!==42||!result.done||count!==1)throw 3;const next=await g.next();if(next.value!==undefined||!next.done)throw 4;`,
  `const AsyncGeneratorFunction=(async function*(){}).constructor,f=AsyncGeneratorFunction("yield missingGlobal;");const marker={};let caught;try{await f().throw(marker);}catch(e){caught=e;}if(caught!==marker)throw 1;let construct=false;try{new f();}catch(e){construct=e instanceof TypeError;}if(!construct)throw 2;`,
  `const other=$262.createRealm().global,target=other.Function("");target.prototype=null;const AsyncGeneratorFunction=(async function*(){}).constructor,f=Reflect.construct(AsyncGeneratorFunction,["yield missingGlobal;"],target),prototype=Object.getPrototypeOf(f);if(prototype===AsyncGeneratorFunction.prototype||Object.getPrototypeOf(prototype)!==other.Function.prototype)throw 1;const result=await f().return(42);if(result.value!==42||!result.done)throw 2;`,
  `const C=(async function*(){}).constructor,events=[];C("")().next().then(r=>{if(r.value!==undefined||!r.done)throw 1;events.push("empty");});C("return;")().next().then(r=>{if(r.value!==undefined||!r.done)throw 2;events.push("bare");});C("return undefined;")().next().then(r=>{if(r.value!==undefined||!r.done)throw 4;events.push("return");});Promise.resolve().then(()=>events.push("promise"));await Promise.resolve();await Promise.resolve();if(events.join(",")!=="empty,bare,promise,return")throw 3;`,
  `const C=(async function*(){}).constructor,f=C("value","return value;");let called=0;const g=f({then(resolve){called++;resolve(42);}});if(called!==0)throw 1;const pending=g.next();if(called!==0)throw 2;const result=await pending;if(result.value!==42||!result.done||called!==1)throw 3;for(const value of [null,Symbol(),0n,{}]){const r=await f(value).next();if(r.value!==value||!r.done)throw 4;}const marker={};let caught;try{await f({get then(){throw marker;}}).next();}catch(e){caught=e;}if(caught!==marker)throw 5;`,
];
verifyNativeScriptCases(
  sources.map(
    (source) =>
      `(async()=>{${source}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:dynamic-async-generator"));`,
  ),
  { nodeReference: false, asynchronous: true },
);
