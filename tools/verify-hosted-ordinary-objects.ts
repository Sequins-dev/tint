import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {makeMethod,getSuperBase,createCallableObject,createObject,defineOwnProperty,getOwnProperty,getProperty,setProperty,deleteProperty,hasProperty,setPrototype,preventExtensions,ownKeys,setIntegrityLevel,testIntegrityLevel,toPropertyDescriptor,fromPropertyDescriptor,type ObjectHooks,type DescriptorKeys} from "object";
import {emptyUpdate} from "descriptor";
function same(a:number,b:number):boolean{return a===b?(a!==0||1/a===1/b):a!==a&&b!==b;}
function order(key:string):number{if(key==="2")return 2;if(key==="10")return 10;return -1;}
function fromBoolean(value:boolean):number{return value?31:30;}
function toBoolean(value:number):boolean{return value===31;}
function callable(value:number):boolean{return value===17||value===18;}
export function run():number{
 let observed=0,argument=0;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:same,call:(callee,receiver,args):number=>{observed=receiver;argument=args[0]??0;return callee===17?7:0;}};
 const parent=createObject<string,number>(undefined),child=createObject<string,number>(parent);
 const data={...emptyUpdate<number>(0),fields:51,value:3,writable:true,enumerable:true,configurable:true};
 if(defineOwnProperty<string,number>(parent,"x",data,hooks)!=="accepted")return 1;
 if(getProperty<string,number>(child,"x",2,hooks)!==3)return 2;
 if(!setProperty<string,number>(parent,"x",4,{value:2,object:child},hooks))return 3;
 if(getOwnProperty<string,number>(parent,"x")?.value!==3||getOwnProperty<string,number>(child,"x")?.value!==4)return 4;
 defineOwnProperty<string,number>(parent,"accessor",{...emptyUpdate<number>(0),fields:44,get:17,set:18,configurable:true},hooks);
 if(getProperty<string,number>(child,"accessor",2,hooks)!==7||observed!==2)return 5;
 if(!setProperty<string,number>(parent,"accessor",8,{value:2,object:child},hooks)||observed!==2||argument!==8)return 6;
 if(getOwnProperty<string,number>(child,"accessor")!==undefined)return 7;
 if(setPrototype<string,number>(parent,child))return 8;
 defineOwnProperty<string,number>(child,"10",data,hooks);defineOwnProperty<string,number>(child,"2",data,hooks);
 const keys=ownKeys<string,number>(child,order);if(keys.join()!=="2,10,x")return 9;
 if(!deleteProperty<string,number>(child,"x")||getProperty<string,number>(child,"x",2,hooks)!==3)return 10;
 preventExtensions<string,number>(child);
 if(setProperty<string,number>(parent,"x",9,{value:2,object:child},hooks))return 11;
 if(!setPrototype<string,number>(child,parent)||setPrototype<string,number>(child,undefined))return 12;
 if(!hasProperty<string,number>(child,"accessor")||hasProperty<string,number>(child,"missing"))return 13;
 const descriptorKeys:DescriptorKeys<string>={value:"value",writable:"writable",get:"get",set:"set",enumerable:"enumerable",configurable:"configurable"};
 const exported=fromPropertyDescriptor<string,number>(getOwnProperty<string,number>(parent,"x"),undefined,descriptorKeys,hooks,fromBoolean);
 if(exported===undefined)return 14;
 if(ownKeys<string,number>(exported,order).join()!=="value,writable,enumerable,configurable")return 15;
 const converted=toPropertyDescriptor<string,number>(exported,3,descriptorKeys,hooks,toBoolean,callable);
 if(converted.error!=="none"||converted.update.fields!==51||converted.update.value!==3||!converted.update.writable)return 16;
 defineOwnProperty<string,number>(exported,"get",{...data,value:99},hooks);
 if(toPropertyDescriptor<string,number>(exported,3,descriptorKeys,hooks,toBoolean,callable).error!=="getter")return 17;
 if(!setIntegrityLevel<string,number>(parent,false,hooks, (key):number=>-1)||!testIntegrityLevel<string,number>(parent,false, (key):number=>-1)||testIntegrityLevel<string,number>(parent,true, (key):number=>-1))return 18;
 if(!setProperty<string,number>(parent,"x",9,{value:1,object:parent},hooks))return 19;
 if(!setIntegrityLevel<string,number>(parent,true,hooks, (key):number=>-1)||!testIntegrityLevel<string,number>(parent,true, (key):number=>-1))return 20;
 if(setProperty<string,number>(parent,"x",10,{value:1,object:parent},hooks)||deleteProperty<string,number>(parent,"x"))return 21;
 if(!setProperty<string,number>(parent,"accessor",12,{value:1,object:parent},hooks)||argument!==12)return 22;
 if(!setIntegrityLevel<string,number>(parent,true,hooks, (key):number=>-1))return 23;
 const home=createObject<string,number>(parent);
 const method=createCallableObject<string,number>(undefined,(receiver,args):number=>receiver);
 makeMethod<string,number>(method,home);
 const captured=getSuperBase<string,number>(method);
 if(captured===undefined)return 24;
 if(getProperty<string,number>(captured,"accessor",13,hooks)!==7||observed!==13)return 25;
 if(!setProperty<string,number>(captured,"accessor",14,{value:15,object:undefined},hooks)||observed!==15||argument!==14)return 26;
 if(!setPrototype<string,number>(home,undefined))return 27;
 if(getSuperBase<string,number>(method)!==undefined||captured!==parent)return 28;
 if(method.internalHomeObject!==home)return 29;
 return 42;
}`,
  "ordinary-objects",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["descriptor", "packages/js-runtime/src/descriptors/index.ts"],
  ],
);
