import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createDataProperty,defineOwnProperty,getProperty,setProperty,type ObjectHooks} from "object";
import {emptyUpdate} from "descriptor";
function same(a:unknown,b:unknown):boolean {
 if(typeof a==="number"&&typeof b==="number")return a===b?(a!==0||1/a===1/b):a!==a&&b!==b;
 return a===b;
}
function mixed(index:number):number|string|boolean|null|undefined {
 if(index===0)return undefined;if(index===1)return null;
 if(index===2)return false;if(index===3)return "text";return 42;
}
export function run():number{
 for(let i=0;i<5;i++){
  const packed:unknown=mixed(i);
  if(i===0&&packed!==undefined)return 10;
  if(i===1&&packed!==null)return 11;
  if(i===2&&packed!==false)return 12;
  if(i===3&&packed!=="text")return 13;
  if(i===4&&packed!==42)return 14;
 }
 const object=createObject<string,unknown>(undefined);
 const values:unknown[]=[1,"text",object,undefined,false];
 values.push(42);values[0]=19;
 const first=values[0],last=values[5];
 if(typeof first!=="number"||typeof last!=="number"||first!==19||last!==42)return 1;
 if(values[1]!=="text"||values[2]!==object||values[3]!==undefined||values[4]!==false)return 2;
 let stored:unknown=undefined,observed:unknown=undefined;
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:same,call:(callee,receiver,args):unknown=>{
  observed=receiver;
  if(callee===17)return values[5];
  stored=args[0];return undefined;
 }};
 if(!createDataProperty<string,unknown>(object,"value",object,hooks))return 3;
 if(getProperty<string,unknown>(object,"value",object,hooks)!==object)return 4;
 defineOwnProperty<string,unknown>(object,"accessor",{...emptyUpdate<unknown>(undefined),fields:60,get:17,set:18,enumerable:true,configurable:true},hooks);
 const read=getProperty<string,unknown>(object,"accessor",object,hooks);
 if(read!==42||observed!==object)return 5;
 if(!setProperty<string,unknown>(object,"accessor","written",{value:object,object},hooks))return 6;
 if(stored!=="written")return 7;
 values.length=7;
 if(values[6]!==undefined)return 8;
 values.length=0;
 if(values[0]!==undefined)return 9;
 return 42;
}`,
  "dynamic-object-values",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["descriptor", "packages/js-runtime/src/descriptors/index.ts"],
  ],
);
