import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createGlobalEnvironment,createGlobalScope,createObjectEnvironment,createObjectScope,resolveBinding,getBindingReference,putBindingReference,deleteBindingReference,getBindingThisValue,hasObjectBinding,type ObjectEnvironmentHooks} from "global";
import {createObject,defineOwnProperty,deleteProperty,type OrdinaryObject} from "object";
import {emptyUpdate,valueField,writableField,configurableField,getField} from "descriptor";
export function run():number {
 const outer=createObject<string,number>(undefined);
 const prototype=createObject<string,number>(undefined);
 const inner=createObject<string,number>(prototype);
 const blocked=createObject<string,number>(undefined);
 let calls=0;
 const hooks:ObjectEnvironmentHooks<string,number>={
  undefinedValue:0,sameValue:(a,b):boolean=>a===b,
  call:(callee,receiver,args):number=>{calls+=1;if(receiver!==2)throw 91;return 3;},
  keyForName:(name):string=>name,unscopablesKey:"@@unscopables",
  asObject:(value):OrdinaryObject<string,number>|undefined=>value===3?blocked:undefined,
  truthy:(value):boolean=>value!==0,
 };
 function property(object:OrdinaryObject<string,number>,name:string,value:number):void {
  const update={...emptyUpdate<number>(0),fields:valueField|writableField|configurableField,value,writable:true,configurable:true};
  if(!defineOwnProperty<string,number>(object,name,update,hooks))throw 92;
 }
 property(outer,"x",19);property(prototype,"x",42);
 const root=createGlobalScope<string,number>(createGlobalEnvironment<string,number>(outer,1,1,hooks.keyForName,hooks));
 const record=createObjectEnvironment<string,number>(inner,2,true,hooks);
 const scope=createObjectScope<string,number>(root,record);
 const ref=resolveBinding<string,number>(scope,"x",true);
 if(getBindingReference<string,number>(ref).value!==42||getBindingThisValue<string,number>(ref)!==2)return 1;
 const getter={...emptyUpdate<number>(0),fields:getField|configurableField,get:7,configurable:true};
 if(!defineOwnProperty<string,number>(inner,"@@unscopables",getter,hooks))return 2;
 if(hasObjectBinding<string,number>(record,"absent")||calls!==0)return 3;
 property(blocked,"x",1);
 const filtered=resolveBinding<string,number>(scope,"x",false);
 if(calls!==1||getBindingReference<string,number>(filtered).value!==19||getBindingThisValue<string,number>(filtered)!==0)return 4;
 if(putBindingReference<string,number>(ref,41)!=="none"||getBindingReference<string,number>(ref).value!==41||calls!==1)return 5;
 if(!deleteBindingReference<string,number>(ref))return 6;
 deleteProperty<string,number>(prototype,"x");
 if(getBindingReference<string,number>(ref).error!=="reference")return 7;
 if(putBindingReference<string,number>(ref,42)!=="reference")return 8;
 if(putBindingReference<string,number>({...ref,strict:false},42)!=="none"||getBindingReference<string,number>(ref).value!==42)return 10;
 const plain=createObjectScope<string,number>(root,createObjectEnvironment<string,number>(inner,2,false,hooks));
 const plainRef=resolveBinding<string,number>(plain,"x",false);
 if(getBindingThisValue<string,number>(plainRef)!==0||calls!==1)return 9;
 return getBindingReference<string,number>(plainRef).value;
}`,
  "object-environment",
  [
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["descriptor", "packages/js-runtime/src/descriptors/index.ts"],
  ],
);
