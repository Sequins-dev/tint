import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {type ScriptPropertyKey,createArgumentsObject,createSourceFunction,callObjectValue,createErrorRealm,viewObjectValue,createObject,getOwnProperty,getProperty,setProperty,deleteProperty,setIntegrityLevel,exoticSlots,ensureRareSlots,type ArgumentsIntrinsics,type ObjectHooks,type DataAlias} from "object";
import {instantiateFunctionArguments,type FunctionArgumentsPlan} from "global-environment";
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding,getBindingValue,setMutableBinding} from "environment-record";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>{if(callee===99)throw 17;throw 18;}};
export function run():number{
 const root=createObject<number,number>(undefined);
 const intrinsics:ArgumentsIntrinsics<number,number>={prototype:root,lengthKey:100,calleeKey:101,iteratorKey:102,values:98,throwTypeError:99,indexKey:(index:number):number=>index,numberValue:(value:number):number=>value};
 let parameter=2;
 const binding=(name:string):DataAlias<number> =>({get:():number=>parameter,set:(value:number):void=>{parameter=value;}});
 const mapped=createArgumentsObject<number,number>([1,2,3],{names:["a","a"],callee:97,binding},intrinsics,hooks);
 if(!(mapped.internalRareSlots?.internalArgumentsData??false)||(root.internalRareSlots?.internalArgumentsData??false))return 1;
 parameter=42;
 if(getProperty<number,number>(mapped,0,1,hooks)!==1||getProperty<number,number>(mapped,1,1,hooks)!==42)return 2;
 if(!setProperty<number,number>(mapped,1,7,{value:1,object:mapped},hooks)||parameter!==7)return 3;
 if(getProperty<number,number>(mapped,100,1,hooks)!==3||getProperty<number,number>(mapped,102,1,hooks)!==98)return 4;
 const callee=getOwnProperty<number,number>(mapped,101);
 if(callee===undefined||callee.accessor||callee.value!==97||!callee.writable||callee.enumerable||!callee.configurable)return 5;
 setIntegrityLevel<number,number>(mapped,true,hooks, (key):number=>-1);
 parameter=9;
 if(getProperty<number,number>(mapped,1,1,hooks)!==7)return 6;
 const missing=createArgumentsObject<number,number>([1],{names:["a","a"],callee:97,binding},intrinsics,hooks);
 parameter=42;
 if(getProperty<number,number>(missing,0,2,hooks)!==1||getOwnProperty<number,number>(missing,1)!==undefined)return 7;
 const unmapped=createArgumentsObject<number,number>([3,0],undefined,intrinsics,hooks);
 const poison=getOwnProperty<number,number>(unmapped,101);
 if(poison===undefined||!poison.accessor||poison.get!==99||poison.set!==99||poison.enumerable||poison.configurable)return 8;
 if(!(unmapped.internalRareSlots?.internalArgumentsData??false)||deleteProperty<number,number>(unmapped,101))return 9;
 let caught=0;
 try{getProperty<number,number>(unmapped,101,3,hooks);}catch(error){if(error===17)caught=1;}
 if(caught!==1)return 10;
 const empty=createArgumentsObject<number,number>([],undefined,intrinsics,hooks);
 if(getProperty<number,number>(empty,100,4,hooks)!==0||getOwnProperty<number,number>(empty,0)!==undefined)return 11;
 const unknownHooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{throw "unexpected call";}};
 const objectPrototype=createObject<ScriptPropertyKey,unknown>(undefined);
 const realm=createErrorRealm(objectPrototype,unknownHooks);
 const thrower=realm.throwTypeError;
 const throwCall=thrower.internalRareSlots?.internalCall;
 if(throwCall===undefined||(thrower.internalFlags&1)!==0||thrower.prototype!==realm.functionPrototype)return 16;
 let threw=false;
 try{throwCall(undefined,[]);}catch(error){
  const object=viewObjectValue(error,objectPrototype);
  if(object!==undefined&&exoticSlots(object).internalErrorData&&object.prototype===realm.prototypes.get("type"))threw=true;
 }
 if(!threw)return 17;
 const tagged=createObject<ScriptPropertyKey,unknown>(objectPrototype);
 ensureRareSlots<ScriptPropertyKey,unknown>(tagged).internalArgumentsData=true;
 const stringifier=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(objectPrototype,"toString",objectPrototype,unknownHooks),objectPrototype);
 if(stringifier===undefined)return 12;
 const invoke=stringifier.internalRareSlots?.internalCall;
 if(invoke===undefined)return 13;
 if(invoke(tagged,[])!=="[object Arguments]")return 14;
 const child=createObject<ScriptPropertyKey,unknown>(tagged);
 if(invoke(child,[])!=="[object Object]")return 15;
 const plan:FunctionArgumentsPlan={arrow:false,strict:false,simple:true,parameterExpressions:false,parameters:["a"],functions:[],lexical:[]};
 const parameters=createDeclarativeEnvironment<number>(0);
 createMutableBinding<number>(parameters,"a",false);
 const argsObject=instantiateFunctionArguments<number,number>(parameters,[1],97,plan,intrinsics,hooks,(value):number=>50);
 if(argsObject===undefined||getBindingValue<number>(parameters,"arguments").value!==50)return 18;
 initializeBinding<number>(parameters,"a",42);
 if(getProperty<number,number>(argsObject,0,50,hooks)!==42)return 19;
 setProperty<number,number>(argsObject,0,9,{value:50,object:argsObject},hooks);
 if(getBindingValue<number>(parameters,"a").value!==9)return 20;
 const strictPlan:FunctionArgumentsPlan={...plan,strict:true};
 const strictParameters=createDeclarativeEnvironment<number>(0);
 createMutableBinding<number>(strictParameters,"a",false);
 const strictArgs=instantiateFunctionArguments<number,number>(strictParameters,[1],97,strictPlan,intrinsics,hooks,(value):number=>51);
 if(strictArgs===undefined)return 21;
 initializeBinding<number>(strictParameters,"a",42);
 if(getProperty<number,number>(strictArgs,0,51,hooks)!==1||setMutableBinding<number>(strictParameters,"arguments",0,true)!=="type")return 22;
 const fn=createSourceFunction((receiver,args,callee,newTarget):unknown=>callee,true,realm,unknownHooks);
 const other=createSourceFunction((receiver,args,callee,newTarget):unknown=>callee,true,realm,unknownHooks);
 if(callObjectValue(fn,other,[],objectPrototype).value!==fn)return 23;
 if(callObjectValue(other,fn,[],objectPrototype).value!==other)return 24;
 const construct=fn.internalRareSlots?.internalConstruct;
 if(construct===undefined||construct([],fn)!==fn||construct([],other)!==fn)return 25;
 return 42;
}
`,
  "arguments",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    [
      "global-environment",
      "packages/js-runtime/src/environments/global/index.ts",
    ],
    [
      "environment-record",
      "packages/js-runtime/src/environments/records/index.ts",
    ],
  ],
  [],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
