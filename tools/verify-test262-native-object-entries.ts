import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const s=Symbol(),o={b:19,2:23,1:42,[s]:7};Object.defineProperty(o,"hidden",{value:1});const e=Object.entries(o);if(e.length!==3||e[0][0]!=="1"||e[0][1]!==42||e[1][0]!=="2"||e[2][0]!=="b")throw 1;if(Object.values(o).join()!=="42,23,19")throw 2;`,
  `const o={get a(){delete this.b;Object.defineProperty(this,"c",{enumerable:false});this.d=4;return 1;},b:2,c:3};const e=Object.entries(o);if(e.length!==1||e[0][0]!=="a"||e[0][1]!==1)throw 1;`,
  `const e=Object.entries("ab");if(e.length!==2||e[0][0]!=="0"||e[0][1]!=="a"||e[1][1]!=="b")throw 1;if(Object.values(19).length!==0)throw 2;let caught=false;try{Object.entries(null);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  `let order="";const s=Symbol(),p=new Proxy({a:19,b:23,[s]:42},{ownKeys(){order+="k";return ["b",s,"a"];},getOwnPropertyDescriptor(t,k){order+="d"+k;return Object.getOwnPropertyDescriptor(t,k);},get(t,k){order+="g"+k;return t[k];}});const e=Object.entries(p);if(order!=="kdbgbdaga"||e[0][0]!=="b"||e[0][1]!==23||e[1][0]!=="a")throw 1;`,
  `let read=0;const o={get x(){read++;throw 42;}};if(Object.keys(o).join()!=="x"||read!==0)throw 1;let caught=false;try{Object.values(o);}catch(e){caught=e===42;}if(!caught||read!==1)throw 2;`,
  `const invalidValues={n:null,u:undefined,t:true,s:"abc",n12:12,symbol:Symbol(),array:[1,2,3],object:{length:3},prototype:Uint8Array.prototype,bigint:1n};let count=0;Object.entries(invalidValues).forEach(value=>{let caught=false;try{Uint8Array.prototype.toReversed.call(value[1]);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;count++;});if(count!==10)throw 2;`,
]);
