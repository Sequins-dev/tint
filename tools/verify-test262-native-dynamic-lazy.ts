import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases([
  `const cases=[[[],0],[["a","a"],2],[["{x=1}","[y]"],2],[["a","b=1","c"],1],[["a","...rest"],1]];for(const [parameters,length] of cases){const f=Function(...parameters,"missingGlobal;");if(f.length!==length||f.name!=="anonymous"||typeof f!=="function")throw 1;}if(Function("return 42;")()!==42)throw 2;`,
  `const AsyncFunction=(async function(){}).constructor;const f=AsyncFunction("a","b=1","await missingGlobal;");if(f.length!==1||f.name!=="anonymous"||f.hasOwnProperty("prototype"))throw 1;`,
  `const GeneratorFunction=(function*(){}).constructor;const f=GeneratorFunction("x","yield x;");if(f.length!==1||f.name!=="anonymous"||!f.hasOwnProperty("prototype"))throw 1;const g=f(42),returned=g.return(19);if(!returned.done||returned.value!==19)throw 2;const value={};let caught;try{f(42).throw(value);}catch(e){caught=e;}if(caught!==value)throw 3;`,
  `const GeneratorFunction=(function*(){}).constructor;const f=GeneratorFunction("x","return x;");for(const x of [42,null,{},Symbol()]){const result=f(x).next();if(!result.done||result.value!==x)throw 1;}const g=Function("x","return x;");if(g(19)!==19||g(23)!==23)throw 2;`,
  `let reads=0;const target=new Proxy(function(){},{get(t,k,r){if(k==="prototype"){reads++;return null;}return Reflect.get(t,k,r);}});let caught=false;try{Reflect.construct(Function,["a","let a;"],target);}catch(e){caught=e instanceof SyntaxError;}if(!caught||reads!==0)throw 1;const f=Reflect.construct(Function,["missingGlobal;"],target);if(reads!==1||Object.getPrototypeOf(f)!==Function.prototype)throw 2;`,
]);
