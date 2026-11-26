import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createArrayObject,createDataProperty,getOwnProperty,defineOwnProperty,deleteProperty,stringPropertyKeyOrder,type ObjectHooks,type ArrayObjectHooks} from "object";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>0};
const array:ArrayObjectHooks<string,number>={lengthKey:"length",index:(key):number=>stringPropertyKeyOrder(key),toNumber:(value):number=>value,indexKey:(index):string=>String(index),numberPayload:(value):number|undefined=>value,fromNumber:(value):number=>value,fromGeneral:(value):number=>0,rangeError:():number=>99};
export function run():number{
 const object=createArrayObject<string,number>(0,undefined,array,hooks);
 if((object.internalFlags&8)===0)return 1;
 createDataProperty<string,number>(object,"4",42,hooks);
 createDataProperty<string,number>(object,"2",42,hooks);
 const length=getOwnProperty<string,number>(object,"length");
 if(length===undefined||length.value!==5||length.enumerable||length.configurable)return 2;
 defineOwnProperty<string,number>(object,"2",{fields:32,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
 const shrunk=defineOwnProperty<string,number>(object,"length",{fields:3,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
 const restored=getOwnProperty<string,number>(object,"length");
 if(shrunk!=="rejected"||restored===undefined||restored.value!==3||restored.writable)return 3;
 if(getOwnProperty<string,number>(object,"4")!==undefined)return 4;
 if(createDataProperty<string,number>(object,"3",42,hooks))return 5;
 if(!createDataProperty<string,number>(object,"1",42,hooks))return 6;
 const sparse=createArrayObject<string,number>(0,undefined,array,hooks);
 createDataProperty<string,number>(sparse,"4294967294",42,hooks);
 const huge=getOwnProperty<string,number>(sparse,"length");
 if(huge===undefined||huge.value!==4294967295)return 7;
 defineOwnProperty<string,number>(sparse,"length",{fields:1,value:0,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
 if(getOwnProperty<string,number>(sparse,"4294967294")!==undefined)return 8;
 let caught=false;
 try{defineOwnProperty<string,number>(sparse,"length",{fields:1,value:1.5,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);}catch(error){if(error===99)caught=true;}
 if(!caught||deleteProperty<string,number>(sparse,"length"))return 9;
 return 42;
}
`,
  "array-objects",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
