import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createAliasedObject,createObject,createDataProperty,aliasDataProperty,getOwnProperty,getProperty,setProperty,defineOwnProperty,deleteProperty,setIntegrityLevel,type ObjectHooks} from "object";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>{throw "unexpected user call";}};
export function run():number{
 let parameter=1;
 const object=createAliasedObject<string,number>(undefined);
 createDataProperty<string,number>(object,"0",parameter,hooks);
 aliasDataProperty<string,number>(object,"0",{get:():number=>parameter,set:(value:number):void=>{parameter=value;}});
 parameter=42;
 const descriptor=getOwnProperty<string,number>(object,"0");
 if(descriptor===undefined||descriptor.accessor||descriptor.value!==42)return 1;
 if(getProperty<string,number>(object,"0",0,hooks)!==42)return 2;
 if(!setProperty<string,number>(object,"0",7,{value:0,object},hooks)||parameter!==7)return 3;
 const child=createObject<string,number>(object);
 if(!setProperty<string,number>(object,"0",9,{value:0,object:child},hooks)||parameter!==7)return 4;
 if(getProperty<string,number>(child,"0",0,hooks)!==9)return 5;
 setIntegrityLevel<string,number>(object,false,hooks, (key):number=>-1);
 parameter=42;
 if(deleteProperty<string,number>(object,"0"))return 6;
 if(getProperty<string,number>(object,"0",0,hooks)!==42)return 7;
 setIntegrityLevel<string,number>(object,true,hooks, (key):number=>-1);
 parameter=9;
 if(getProperty<string,number>(object,"0",0,hooks)!==42)return 8;
 const other=createAliasedObject<string,number>(undefined);
 createDataProperty<string,number>(other,"0",1,hooks);
 aliasDataProperty<string,number>(other,"0",{get:():number=>parameter,set:(value:number):void=>{parameter=value;}});
 defineOwnProperty<string,number>(other,"0",{fields:3,value:17,writable:false,enumerable:false,configurable:false,get:0,set:0},hooks);
 if(parameter!==17)return 9;
 parameter=18;
 if(getProperty<string,number>(other,"0",0,hooks)!==17)return 10;
 if(!deleteProperty<string,number>(other,"0"))return 11;
 createDataProperty<string,number>(other,"0",21,hooks);
 if(parameter!==18)return 12;
 return 42;
}
`,
  "data-aliases",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
