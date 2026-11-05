import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createDataProperty,defineOwnProperty,deleteProperty,createPropertyEnumeration,nextEnumerableProperty,stringPropertyKeyOrder,type ObjectHooks,type OrdinaryObject} from "object";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>{throw "getter must not run";}};
function add(object:OrdinaryObject<string,number>,key:string):void{createDataProperty<string,number>(object,key,42,hooks);}
export function run():number{
 const parent=createObject<string,number>(undefined),child=createObject<string,number>(parent);
 add(parent,"removed");add(parent,"hidden");add(parent,"tail");
 add(child,"10");add(child,"2");add(child,"removed");
 defineOwnProperty<string,number>(child,"hidden",{fields:51,value:42,writable:true,enumerable:false,configurable:true,get:0,set:0},hooks);
 const iterator=createPropertyEnumeration<string,number>(child,stringPropertyKeyOrder);
 if(nextEnumerableProperty<string,number>(iterator)!=="2")return 1;
 deleteProperty<string,number>(child,"removed");add(child,"late");
 if(nextEnumerableProperty<string,number>(iterator)!=="10")return 2;
 if(nextEnumerableProperty<string,number>(iterator)!=="removed")return 3;
 if(nextEnumerableProperty<string,number>(iterator)!=="tail")return 4;
 if(nextEnumerableProperty<string,number>(iterator)!==undefined)return 5;
 add(parent,"after");
 if(nextEnumerableProperty<string,number>(iterator)!==undefined)return 6;
 if(stringPropertyKeyOrder("4294967294")!==4294967294||stringPropertyKeyOrder("4294967295")!==-1||stringPropertyKeyOrder("01")!==-1)return 7;
 return 42;
}
`,
  "enumeration",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
