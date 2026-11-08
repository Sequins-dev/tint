import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createArrayObject,createDataProperty,getOwnProperty,defineOwnProperty,stringPropertyKeyOrder,type ObjectHooks,type ArrayObjectHooks} from "object";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>0};
export function run():number{
 const state={calls:0};
 const array:ArrayObjectHooks<string,number>={lengthKey:"length",index:(key):number=>{state.calls++;return stringPropertyKeyOrder(key);},toNumber:(value):number=>value,indexKey:(index):string=>String(index),numberPayload:(value):number|undefined=>value,fromNumber:(value):number=>value,rangeError:():number=>99};
 const object=createArrayObject<string,number>(0,undefined,array,hooks);
 for(let round=0;round<4;round++){
  for(let i=1023;i>=0;i--)if(!createDataProperty<string,number>(object,String(i),i,hooks))return 1;
  state.calls=0;
  const result=defineOwnProperty<string,number>(object,"length",{fields:1,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
  if(result!=="accepted"||state.calls>1024)return 2;
  const length=getOwnProperty<string,number>(object,"length");
  if(length===undefined||length.value!==0||!length.writable||object.properties.size!==1)return 3;
 }
 createDataProperty<string,number>(object,"3",42,hooks);
 defineOwnProperty<string,number>(object,"3",{fields:32,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
 createDataProperty<string,number>(object,"8",42,hooks);
 if(defineOwnProperty<string,number>(object,"length",{fields:3,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks)!=="rejected")return 4;
 const restored=getOwnProperty<string,number>(object,"length");
 if(restored===undefined||restored.value!==4||restored.writable||getOwnProperty<string,number>(object,"8")!==undefined)return 5;
 const sparse=createArrayObject<string,number>(0,undefined,array,hooks);
 createDataProperty<string,number>(sparse,"4294967294",42,hooks);
 if(defineOwnProperty<string,number>(sparse,"length",{fields:3,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks)!=="accepted")return 6;
 const readonly=getOwnProperty<string,number>(sparse,"length");
 if(readonly===undefined||readonly.value!==0||readonly.writable||sparse.properties.size!==1)return 7;
 return 42;
}`,
  "regexp-harness-array-reset",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
