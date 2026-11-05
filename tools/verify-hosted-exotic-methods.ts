import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createExoticObject,getProperty,hasProperty,setProperty,getPrototype,setPrototype,isExtensible,preventExtensions,ownKeys,deleteProperty,hasPrototype,type ObjectHooks} from "object";
export function run():number{
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>0};
 let observed=0,defined=0,setReceiver=0;
 const parent=createObject<string,number>(undefined);
 const exotic=createExoticObject<string,number>(undefined,{
 get:(object,key,receiver,hooks):number=>{observed=receiver;return key==="x"?42:0;},
 hasProperty:(object,key):boolean=>key==="yes",
 set:(object,key,value,receiver,hooks):boolean=>{setReceiver=receiver.value;return value===9;},
 getOwnProperty:(object,key)=>undefined,
 defineOwnProperty:(object,key,update,hooks)=>{defined=update.value;return "accepted";},
 getPrototype:(object)=>parent,
 setPrototype:(object,prototype):boolean=>false,
 isExtensible:(object):boolean=>false,
 preventExtensions:(object):boolean=>false,
 ownKeys:(object):string[]=>["10","2","x"],
 deleteProperty:(object,key):boolean=>false
 });
 const child=createObject<string,number>(exotic);
 if(getProperty<string,number>(child,"x",7,hooks)!==42||observed!==7)return 1;
 if(!hasProperty<string,number>(child,"yes")||hasProperty<string,number>(child,"no"))return 2;
 if(!setProperty<string,number>(parent,"x",42,{object:exotic,value:1},hooks)||defined!==42)return 3;
 if(getPrototype<string,number>(exotic)!==parent||!hasPrototype<string,number>(exotic,parent))return 4;
 if(setPrototype<string,number>(exotic,undefined)||isExtensible<string,number>(exotic)||preventExtensions<string,number>(exotic)||deleteProperty<string,number>(exotic,"x"))return 5;
 if(ownKeys<string,number>(exotic,(key):number=>0).join()!=="10,2,x")return 6;
 if(!setProperty<string,number>(child,"x",9,{object:child,value:8},hooks)||setReceiver!==8)return 7;
 return 42;
}`,
  "exotic-methods",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
