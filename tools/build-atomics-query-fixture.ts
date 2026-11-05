import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("Atomics query fixture requires TINT_BUILD_ONLY=1");
const object = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `
import {createObject,createErrorRealm,installAtomicsIntrinsics,createCallableObject,createDataProperty,getProperty,callObjectValue,viewObjectValue,type ScriptPropertyKey,type OrdinaryObject,type ObjectHooks} from 'object';
export function run():number {
 const global=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,global);if(result.error!=='none')throw 'HOOK';return result.value;}};
 const realm=createErrorRealm(global,hooks);
 const policy={lockFree1:true,lockFree2:true,lockFree8:true};
 installAtomicsIntrinsics(global,realm,hooks,policy);
 const atomics=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'Atomics',global,hooks),global);
 if(atomics===undefined)return 1;
 function invoke(target:OrdinaryObject<ScriptPropertyKey,unknown>,name:string,args:unknown[]):unknown {
  const method=getProperty<ScriptPropertyKey,unknown>(target,name,target,hooks);
  const result=callObjectValue(method,undefined,args,global);if(result.error!=='none')throw 'METHOD';return result.value;
 }
 if(invoke(atomics,'isLockFree',[4.9])!==true||invoke(atomics,'isLockFree',['8.9'])!==true)return 2;
 if(invoke(atomics,'isLockFree',[3])!==false||invoke(atomics,'isLockFree',[1/0])!==false)return 3;
 policy.lockFree1=false;if(invoke(atomics,'isLockFree',[1])!==true)return 4;
 const input=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
 const fail=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{throw 42;});
 createDataProperty<ScriptPropertyKey,unknown>(input,'valueOf',fail,hooks);
 if(invoke(atomics,'pause',[input])!==undefined)return 5;
 const other=createObject<ScriptPropertyKey,unknown>(undefined);
 const another=createErrorRealm(other,hooks,realm.symbolRegistry,realm.agent);
 installAtomicsIntrinsics(other,another,hooks,{lockFree1:true,lockFree2:true,lockFree8:true});
 let mismatch=false;try{installAtomicsIntrinsics(other,another,hooks,{lockFree1:false,lockFree2:true,lockFree8:true});}catch(error){mismatch=error==='ATOMICS_CAPABILITY_MISMATCH';}
 if(!mismatch)return 6;
 return 42;
}
`,
  "atomics-query-v1",
  [["object", object]],
  [],
  [
    { module: object, name: "viewObjectValue", operation: "view" },
    { module: object, name: "viewSymbolValue", operation: "view" },
    { module: object, name: "viewBigIntValue", operation: "view" },
  ],
  [
    {
      module: object,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    runtimeEntry: "initializeCopyingRuntime",
  },
);
