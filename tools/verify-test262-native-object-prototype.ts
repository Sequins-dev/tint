import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const marker={};const o={toString(){if(this!==o||arguments.length!==0)throw 1;return marker;}};if(Object.prototype.toLocaleString.call(o,"ignored",{})!==marker)throw 2;`,
  `const marker={};const o={get toString(){throw marker;}};let caught;try{Object.prototype.toLocaleString.call(o);}catch(e){caught=e;}if(caught!==marker)throw 1;`,
  `for(const x of [null,undefined,{toString:1}]){let caught=false;try{Object.prototype.toLocaleString.call(x);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}`,
  `const original=Number.prototype.toString;try{Number.prototype.toString=function(){"use strict";if(this!==19)throw 1;return 42;};if(Object.prototype.toLocaleString.call(19)!==42)throw 2;}finally{Number.prototype.toString=original;}`,
  `const p={},o=Object.create(p),child=Object.create(o);if(!p.isPrototypeOf(o)||!p.isPrototypeOf(child)||p.isPrototypeOf(p)||o.isPrototypeOf(p))throw 1;`,
  `for(const x of [undefined,null,1,"x",true,Symbol()])if(Object.prototype.isPrototypeOf.call(null,x)!==false)throw 1;let caught=false;try{Object.prototype.isPrototypeOf.call(null,{});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
  `const p={};let calls=0;const o=new Proxy({}, {getPrototypeOf(){calls++;return p;}});if(!p.isPrototypeOf(o)||calls!==1)throw 1;const marker={};const bad=new Proxy({}, {getPrototypeOf(){throw marker;}});let caught;try{p.isPrototypeOf(bad);}catch(e){caught=e;}if(caught!==marker)throw 2;`,
]);
