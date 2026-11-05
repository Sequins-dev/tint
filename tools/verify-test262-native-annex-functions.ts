import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`if(typeof f!=="undefined")throw 1;if(false){function f(){return 19;}}if(typeof f!=="undefined")throw 2;{function f(){return 42;}}if(f()!==42)throw 3;`,
  String.raw`let f=19;{function f(){return 42;}if(f()!==42)throw 1;}if(f!==19)throw 2;function g(f){{function f(){return 42;}}return f;}if(g(19)!==19)throw 3;function h(f=19){{function f(){return 42;}}return f;}if(h()!==19)throw 4;`,
  String.raw`var seen;{seen=f();function f(){return 19;}function f(){return 42;}}if(seen!==42||f()!==42)throw 1;{f=19;function f(){return 42;}}if(f!==19)throw 2;`,
  String.raw`function g(){if(typeof f!=="undefined")throw 1;{function f(){return 42;}}return f();}if(g()!==42)throw 2;function h(){{function arguments(){return 42;}}return arguments();}if(h()!==42)throw 3;`,
  String.raw`let f=19;function g(){{function f(){return 42;}}return f();}if(g()!==42||f!==19)throw 1;function h(){let f=19;{function f(){return 42;}}return f;}if(h()!==19)throw 2;`,
  String.raw`try{throw 19;}catch(f){{function f(){return 42;}}if(f!==19)throw 1;}if(f()!==42)throw 2;var x;try{throw {x:19};}catch({x}){{function x(){return 42;}}}if(x!==undefined)throw 3;`,
  String.raw`var f=19;const object={f:7};with(object){{function f(){return 42;}}}if(f()!==42||object.f!==7)throw 1;`,
  String.raw`if(false)function f(){return 19;}if(typeof f!=="undefined")throw 1;if(true)function f(){return 42;}else function f(){return 19;}if(f()!==42)throw 2;let g=19;if(true)function g(){return 42;}if(g!==19)throw 3;`,
  String.raw`var seen;{seen=f();label:function f(){return 42;}}if(seen!==42||f()!==42)throw 1;let g=19;{label:function g(){return 42;}if(g()!==42)throw 2;}if(g!==19)throw 3;`,
  String.raw`let f=19;const object={m(){if(typeof f!=="undefined")throw 1;{function f(){return 42;}}return f();}};if(object.m()!==42||f!==19)throw 2;const arrow=()=>{if(typeof f!=="undefined")throw 3;{function f(){return 42;}}return f();};if(arrow()!==42||f!==19)throw 4;`,
]);
