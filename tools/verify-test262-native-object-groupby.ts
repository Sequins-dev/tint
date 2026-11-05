import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const r=Object.groupBy([1,2,3,4],v=>v%2);if(Object.getPrototypeOf(r)!==null||r[0].join()!=="2,4"||r[1].join()!=="1,3")throw 1;const d=Object.getOwnPropertyDescriptor(r,"0");if(!d.writable||!d.enumerable||!d.configurable)throw 2;`,
  `const s=Symbol();const r=Object.groupBy([19,23],(v,i)=>i?s:"__proto__");if(r.__proto__[0]!==19||r[s][0]!==23||Object.getPrototypeOf(r)!==null)throw 1;`,
  `let order="";const r=Object.groupBy([19,23],function(v,i){"use strict";if(this!==undefined||arguments.length!==2)throw 1;order+=v+":"+i+";";return {toString(){order+="k;";return "x";}};});if(order!=="19:0;k;23:1;k;"||r.x.join()!=="19,23")throw 2;`,
  `let touched=false;const input={get [Symbol.iterator](){touched=true;throw 1;}};let caught=false;try{Object.groupBy(input,null);}catch(e){caught=e instanceof TypeError;}if(!caught||touched)throw 2;`,
  `let closed=0;const marker={};const input={[Symbol.iterator](){return this;},next(){return {value:19,done:false};},return(){closed++;throw 2;}};let caught;try{Object.groupBy(input,()=>{throw marker;});}catch(e){caught=e;}if(caught!==marker||closed!==1)throw 3;`,
  `let closed=0;const marker={};const input={[Symbol.iterator](){return this;},next(){return {value:19,done:false};},return(){closed++;return {};}};let caught;try{Object.groupBy(input,()=>({[Symbol.toPrimitive](){throw marker;}}));}catch(e){caught=e;}if(caught!==marker||closed!==1)throw 3;`,
  `let closed=0;const marker={};const input={[Symbol.iterator](){return this;},next(){throw marker;},return(){closed++;return {};}};let caught;try{Object.groupBy(input,()=>0);}catch(e){caught=e;}if(caught!==marker||closed!==0)throw 3;`,
  `const r=Object.groupBy("aba",v=>v);if(r.a.join()!=="a,a"||r.b[0]!=="b")throw 1;const empty=Object.groupBy([],()=>{throw 2;});if(Reflect.ownKeys(empty).length!==0)throw 3;`,
]);
