import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,defineOwnProperty,getOwnProperty,deleteProperty,copyDataProperties,ownKeys,type ObjectHooks} from "object";
import {emptyUpdate} from "descriptor";
function order(key:string):number{if(key==="2")return 2;if(key==="1")return 1;return -1;}
export function run():number{
 const source=createObject<string,number>(undefined),target=createObject<string,number>(undefined);
 let observed=0,visits=0;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>{
   observed=receiver;visits++;
   deleteProperty<string,number>(source,"deleted");
   defineOwnProperty<string,number>(source,"added",{...emptyUpdate<number>(0),fields:51,value:9,writable:true,enumerable:true,configurable:true},hooks);
   return 42;
 }};
 const data={...emptyUpdate<number>(0),fields:51,value:3,writable:true,enumerable:true,configurable:true};
 defineOwnProperty<string,number>(source,"2",data,hooks);
 defineOwnProperty<string,number>(source,"1",data,hooks);
 defineOwnProperty<string,number>(source,"getter",{...emptyUpdate<number>(0),fields:52,get:17,enumerable:true,configurable:true},hooks);
 defineOwnProperty<string,number>(source,"deleted",data,hooks);
 defineOwnProperty<string,number>(source,"excluded",{...emptyUpdate<number>(0),fields:52,get:18,enumerable:true,configurable:true},hooks);
 defineOwnProperty<string,number>(target,"getter",{...emptyUpdate<number>(0),fields:56,set:19,enumerable:true,configurable:true},hooks);
 if(!copyDataProperties<string,number>(target,source,7,["excluded"],order,hooks))return 1;
 if(observed!==7||visits!==1)return 2;
 if(ownKeys<string,number>(target,order).join()!=="1,2,getter")return 3;
 const copied=getOwnProperty<string,number>(target,"getter");
 if(copied===undefined||copied.accessor||copied.value!==42||!copied.writable||!copied.enumerable||!copied.configurable)return 4;
 const blocked=createObject<string,number>(undefined);
 defineOwnProperty<string,number>(blocked,"1",{...emptyUpdate<number>(0),fields:1,value:0},hooks);
 if(copyDataProperties<string,number>(blocked,source,7,[],order,hooks))return 5;
 if(visits!==1)return 6;
 return 42;
}`,
  "object-copy",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["descriptor", "packages/js-runtime/src/descriptors/index.ts"],
  ],
);
