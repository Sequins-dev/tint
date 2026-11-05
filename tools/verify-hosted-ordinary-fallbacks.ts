import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createExoticObject,createDataProperty,getProperty,setProperty,hasProperty,deleteProperty,ownKeys,getOwnProperty,ordinaryGetProperty,ordinarySetProperty,ordinaryHasProperty,ordinaryDeleteProperty,ordinaryOwnKeys,type ObjectHooks} from "objects";
export function run():number {
 let reads=0,writes=0;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):number=>{throw "UNEXPECTED_CALL";}};
 const parent=createExoticObject<string,number>(undefined,{get:(object,key,receiver,hooks):number=>key==="inherited"?19:0,hasProperty:(object,key):boolean=>key==="inherited"});
 const object=createExoticObject<string,number>(parent,{
  get:(target,key,receiver,h):number=>{reads++;return key==="virtual"?42:ordinaryGetProperty<string,number>(target,key,receiver,h);},
  hasProperty:(target,key):boolean=>key==="virtual"||ordinaryHasProperty<string,number>(target,key),
  set:(target,key,value,receiver,h):boolean=>{writes++;return ordinarySetProperty<string,number>(target,key,value,receiver,h);},
  deleteProperty:(target,key):boolean=>ordinaryDeleteProperty<string,number>(target,key),
  ownKeys:(target):string[]=>{const keys=ordinaryOwnKeys<string,number>(target,(key):number=>-1);const result:string[]=["virtual"];for(const key of keys){if(key===undefined)throw "KEY_INVARIANT";result.push(key);}return result;}
 });
 if(!createDataProperty<string,number>(object,"own",23,hooks))return 1;
 if(getProperty<string,number>(object,"own",0,hooks)!==23||getProperty<string,number>(object,"inherited",0,hooks)!==19||getProperty<string,number>(object,"virtual",0,hooks)!==42||reads!==3||!hasProperty<string,number>(object,"inherited"))return 2;
 const receiver=createObject<string,number>(undefined);
 if(!setProperty<string,number>(object,"own",31,{object:receiver,value:0},hooks)||writes!==1)return 3;
 const assigned=getOwnProperty<string,number>(receiver,"own"),original=getOwnProperty<string,number>(object,"own");
 if(assigned===undefined||original===undefined||assigned.value!==31||original.value!==23)return 4;
 const keys=ownKeys<string,number>(object,(key):number=>-1);
 if(keys.length!==2||keys[0]!=="virtual"||keys[1]!=="own")return 5;
 if(!deleteProperty<string,number>(object,"own")||ownKeys<string,number>(object,(key):number=>-1).length!==1)return 6;
 return 42;
}`,
  "ordinary-fallbacks",
  [["objects", "packages/js-runtime/src/objects/index.ts"]],
);
