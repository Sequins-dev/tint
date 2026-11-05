import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,isCallableObject,callObject,createDataProperty,getProperty,preventExtensions,type ObjectHooks} from "object";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const receiver=createObject<string,unknown>(undefined);
 const args:unknown[]=[42,"text"];
 let calls=0;
 const fn=createCallableObject<string,unknown>(undefined,(actual,values):unknown=>{
  calls=calls+1;
  if(actual!==receiver||values!==args||values.length!==2)return 0;
  return values[0];
 });
 if(!isCallableObject<string,unknown>(fn))return 1;
 if(!createDataProperty<string,unknown>(fn,"answer",42,hooks))return 2;
 if(getProperty<string,unknown>(fn,"answer",fn,hooks)!==42)return 3;
 const result=callObject<string,unknown>(fn,receiver,args,undefined);
 if(result.error!=="none"||result.value!==42||calls!==1)return 4;
 preventExtensions<string,unknown>(fn);
 if(callObject<string,unknown>(fn,receiver,args,undefined).value!==42||calls!==2)return 5;
 const child=createObject<string,unknown>(fn);
 createDataProperty<string,unknown>(child,"call",fn,hooks);
 if(isCallableObject<string,unknown>(child))return 6;
 if(callObject<string,unknown>(child,receiver,args,undefined).error!=="type")return 7;
 if(callObject<string,unknown>(undefined,receiver,args,undefined).error!=="type")return 8;
 return 42;
}`,
  "callable-objects",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
