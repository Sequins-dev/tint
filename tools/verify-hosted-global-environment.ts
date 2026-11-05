import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {instantiateGlobalDeclarations,validateGlobalDeclarations,type GlobalDeclarations,createGlobalEnvironment,createGlobalVarBinding,createGlobalFunctionBinding,getGlobalBinding,setGlobalBinding,deleteGlobalBinding,hasRestrictedGlobalProperty,canDeclareGlobalVar,canDeclareGlobalFunction} from "global";
import {createObject,getOwnProperty,preventExtensions,type ObjectHooks} from "object";
import {createMutableBinding,initializeBinding} from "environment";
function key(name:string):string{return name;}
export function run():number{
 const object=createObject<string,number>(undefined);
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>99};
 const record=createGlobalEnvironment<string,number>(object,1,2,key,hooks);
 if(record.thisValue!==2)return 1;
 if(createGlobalVarBinding<string,number>(record,"x",false)!=="none")return 2;
 if(setGlobalBinding<string,number>(record,"x",1,true)!=="none")return 3;
 createMutableBinding<number>(record.lexical,"x",false);
 if(getGlobalBinding<string,number>(record,"x",false).error!=="reference")return 4;
 initializeBinding<number>(record.lexical,"x",42);
 if(getGlobalBinding<string,number>(record,"x",true).value!==42)return 5;
 if(getOwnProperty<string,number>(object,"x")?.value!==1)return 6;
 if(deleteGlobalBinding<string,number>(record,"x"))return 7;
 if(!hasRestrictedGlobalProperty<string,number>(record,"x"))return 8;
 if(createGlobalFunctionBinding<string,number>(record,"f",17,false)!=="none")return 9;
 if(getGlobalBinding<string,number>(record,"f",true).value!==17)return 10;
 if(setGlobalBinding<string,number>(record,"missing",1,true)!=="reference")return 11;
 if(setGlobalBinding<string,number>(record,"missing",3,false)!=="none")return 12;
 if(!deleteGlobalBinding<string,number>(record,"missing"))return 13;
 preventExtensions<string,number>(object);
 if(canDeclareGlobalVar<string,number>(record,"new")||canDeclareGlobalFunction<string,number>(record,"new"))return 14;
 if(!canDeclareGlobalVar<string,number>(record,"f")||!canDeclareGlobalFunction<string,number>(record,"f"))return 15;
 const fresh=createGlobalEnvironment<string,number>(createObject<string,number>(undefined),1,1,key,hooks);
 let calls=0;
 const plan:GlobalDeclarations<number>={lexical:[{name:"lex",constant:true}],variables:["v","f"],functions:[
  {name:"f",instantiate:():number=>{calls+=100;return 0;}},
  {name:"g",instantiate:():number=>{calls=calls*10+1;return 7;}},
  {name:"f",instantiate:():number=>{calls=calls*10+2;return 42;}}
 ]};
 if(validateGlobalDeclarations<number>(plan)!==undefined)return 16;
 if(instantiateGlobalDeclarations<string,number>(fresh,plan)!=="none")return 17;
 if(calls!==12||getGlobalBinding<string,number>(fresh,"f",true).value!==42)return 18;
 if(getGlobalBinding<string,number>(fresh,"lex",true).error!=="reference")return 19;
 if(getGlobalBinding<string,number>(fresh,"v",true).value!==0)return 20;
 const conflict:GlobalDeclarations<number>={lexical:[{name:"v",constant:false}],variables:[],functions:[]};
 if(instantiateGlobalDeclarations<string,number>(fresh,conflict)!=="syntax")return 21;
 return 42;
}`,
  "global-environment",
  [
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["environment", "packages/js-runtime/src/environments/records/index.ts"],
  ],
);
