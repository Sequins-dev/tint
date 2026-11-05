import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `if(Function("return undefined;")()!==undefined||Function("return Infinity;")()!==Infinity||!Number.isNaN(Function("return NaN;")()))throw 1;for(const name of ["undefined","NaN","Infinity"]){if(Function(name,"return "+name+";")(42)!==42)throw 2;}`,

  `const f=Function("ignored","value","return value;");for(const value of [undefined,null,false,42,"text",Symbol(),{}])if(f(1,value)!==value)throw 1;if(f.length!==2||f(1)!==undefined)throw 2;const g=Function("value","value","return value;");if(g(1,42)!==42||g(1)!==undefined)throw 3;`,
  `const f=Function("unused","return this;");const receiver={};if(f.length!==1||f.call(receiver,42)!==receiver)throw 1;const g=Function("$tint$receiver","return $tint$receiver;");if(g(42)!==42)throw 2;`,
  `const f=Function("return this;");if(f()!==globalThis||f.call(null)!==globalThis||f.call(undefined)!==globalThis)throw 1;const receiver={};if(f.call(receiver)!==receiver)throw 2;if(typeof f.call(42)!=="object"||f.call(42).valueOf()!==42)throw 3;`,
  `const f=Function("'use strict';return this;");for(const value of [undefined,null,false,42,"text",{}])if(f.call(value)!==value)throw 1;`,
  `for(const body of ["","return;"]){const f=Function(body);if(f()!==undefined)throw 1;}if(Function("return 42;")()!==42||Function("return true;")()!==true||Function("return null;")()!==null)throw 2;`,
  `const f=Function("return this;");if(f.name!=="anonymous"||f.length!==0||Object.getPrototypeOf(f)!==Function.prototype)throw 1;const value=new f();if(Object.getPrototypeOf(value)!==f.prototype||!(value instanceof f))throw 2;if(Function.prototype.toString.call(f)!=="function anonymous(\\n) {\\nreturn this;\\n}")throw 3;`,
  `let count=0;const target=new Proxy(function(){},{get(t,key,r){if(key==="prototype"){count++;return null;}return Reflect.get(t,key,r);}});const f=Reflect.construct(Function,["return this;"],target);if(count!==1||Object.getPrototypeOf(f)!==Function.prototype||f()!==globalThis)throw 1;`,
  `const f=Function("return this;");if(Reflect.ownKeys(Function.prototype)[0]!=="length"||Reflect.ownKeys(Function.prototype)[1]!=="name")throw 1;`,
]);
