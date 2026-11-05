import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `for(const fn of [Error,TypeError,Map,Set,Array,Object,Function,Promise,Symbol,BigInt,RegExp,Number,String,Boolean,ArrayBuffer,DataView,Uint8Array,Iterator,Proxy]){const name=fn.name,text=Function.prototype.toString.call(fn);if(!text.includes("[native code]")||!text.includes(name))throw 1;}if(!String(Function.prototype).includes("[native code]"))throw 2;`,
    `const fn=Map.prototype.get,text=String(fn);Object.defineProperty(fn,"name",{get(){throw 1;}});Object.defineProperty(fn,"length",{get(){throw 2;}});if(String(fn)!==text||!text.includes("get"))throw 3;const getter=Object.getOwnPropertyDescriptor(Set.prototype,"size").get;if(!String(getter).includes("get size"))throw 4;`,
    `const fn=(function source(){}).bind(null);Object.defineProperty(fn,"name",{get(){throw 1;}});if(!Function.prototype.toString.call(fn).includes("[native code]"))throw 2;const proxy=new Proxy(function(){},{get(){throw 3;}});if(!Function.prototype.toString.call(proxy).includes("[native code]"))throw 4;const revoked=Proxy.revocable(function(){},{});revoked.revoke();if(!Function.prototype.toString.call(revoked.proxy).includes("[native code]"))throw 5;`,
    `for(const value of [undefined,null,1,true,"x",Symbol(),1n,{},[],new Proxy({}, {})]){let caught=false;try{Function.prototype.toString.call(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}`,
    `const map=new Map([[1,0]]);let calls=0;function callback(){calls++;throw new Error("called");}if(map.getOrInsertComputed(1,callback)!==0||calls!==0)throw 1;let caught;try{map.getOrInsertComputed(2,callback);}catch(e){caught=e;}if(!(caught instanceof Error)||calls!==1)throw 2;let message=Error;message+=" ";if(!message.includes("[native code]"))throw 3;`,
  ],
  { nodeReference: false },
);
