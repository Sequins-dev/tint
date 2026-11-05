import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding} from "declarative";
import {createObject,type ObjectHooks} from "object";
import {createGlobalEnvironment,createGlobalScope,createDeclarativeScope,resolveBinding,getBindingReference,putBindingReference,getGlobalBinding,instantiateFunctionBody,type FunctionBodyDeclarations} from "global";
export function run():number {
 const object=createObject<string,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const global=createGlobalEnvironment<string,unknown>(object,object,object,(name:string):string=>name,hooks);
 const root=createGlobalScope<string,unknown>(global);
 const parameter=createDeclarativeEnvironment<unknown>(undefined);
 createMutableBinding<unknown>(parameter,"a",false);initializeBinding<unknown>(parameter,"a",object);
 const parameters=createDeclarativeScope<string,unknown>(root,parameter);
 const captured=resolveBinding<string,unknown>(parameters,"a",true);
 const local=createDeclarativeEnvironment<unknown>(undefined);
 createMutableBinding<unknown>(local,"a",false);
 const body=createDeclarativeScope<string,unknown>(parameters,local);
 const current=resolveBinding<string,unknown>(body,"a",true);
 if(current.scope===undefined||getBindingReference<string,unknown>(current).error!=="reference")return 1;
 if(putBindingReference<string,unknown>(current,42)!=="reference")return 2;
 initializeBinding<unknown>(local,"a",2);
 if(putBindingReference<string,unknown>(current,42)!=="none")return 3;
 if(getBindingReference<string,unknown>(captured).value!==object)return 4;
 if(getBindingReference<string,unknown>(current).value!==42)return 5;
 const absent=resolveBinding<string,unknown>(body,"missing",false);
 if(absent.scope!==undefined||getBindingReference<string,unknown>(absent).error!=="reference")return 6;
 if(putBindingReference<string,unknown>(absent,"created")!=="none")return 7;
 if(getGlobalBinding<string,unknown>(global,"missing",true).value!=="created")return 8;
 if(getBindingReference<string,unknown>(absent).error!=="reference")return 9;
 const callable=():number=>42;
 let initialized=false;
 const plan:FunctionBodyDeclarations<string,unknown>={separate:true,variables:["a","b"],lexical:[{name:"x",constant:true}],functions:[
  {name:"f",instantiate:(scope):unknown=>{
   const x=getBindingReference<string,unknown>(resolveBinding<string,unknown>(scope,"x",true));
   const a=getBindingReference<string,unknown>(resolveBinding<string,unknown>(scope,"a",true));
   initialized=x.error==="reference"&&a.value===object;
   return callable;
  }}
 ]};
 const instantiated=instantiateFunctionBody<string,unknown>(parameters,plan);
 if(!initialized||instantiated===parameters)return 10;
 if(getBindingReference<string,unknown>(resolveBinding<string,unknown>(instantiated,"f",true)).value!==callable)return 11;
 if(putBindingReference<string,unknown>(resolveBinding<string,unknown>(instantiated,"a",true),19)!=="none")return 12;
 if(getBindingReference<string,unknown>(captured).value!==object)return 13;
 return 42;
}`,
  "environment-scopes",
  [
    ["declarative", "packages/js-runtime/src/environments/records/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
  ],
);
