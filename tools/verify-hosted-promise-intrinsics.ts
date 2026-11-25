import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createConstructorObject,createDataProperty,createErrorRealm,installPromiseIntrinsics,createScriptAgent,createSymbolRegistry,callObjectValue,constructObject,getProperty,viewObjectValue,drainScriptJobs,type ObjectHooks,type ScriptPropertyKey} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const r=callObjectValue(fn,receiver,args,root);if(r.error!=="none")throw 99;return r.value;}};
 const agent=createScriptAgent(),realm=createErrorRealm(root,hooks,createSymbolRegistry(),agent);
 const constructor=installPromiseIntrinsics(root,realm,hooks,(promise,operation):void=>{});
 const executor=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
  if(receiver!==undefined)throw 90;
  callObjectValue(args[0],undefined,[42],root);throw 19;
 });
 const constructed=constructObject<ScriptPropertyKey,unknown>(constructor,[executor],{object:constructor,value:constructor},undefined);
 const promise=viewObjectValue(constructed.value,root);
 if(promise===undefined)return 1;
 const record=promise.internalExoticSlots?.internalPromiseData;
 if(record===undefined||record.state!=="fulfilled"||record.result!==42)return 2;
 const handler=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
  if(receiver!==undefined||args[0]!==42)throw 91;
  return 84;
 });
 const then=getProperty<ScriptPropertyKey,unknown>(promise,"then",promise,hooks);
 const childResult=callObjectValue(then,promise,[handler],root);
 const child=viewObjectValue(childResult.value,root);
 if(child===undefined)return 3;
 const childRecord=child.internalExoticSlots?.internalPromiseData;
 if(childRecord===undefined||childRecord.state!=="pending")return 4;
 if(drainScriptJobs(agent,(error):void=>{throw error;})!==1)return 5;
 if(childRecord.result!==84)return 6;
 const foreign=createErrorRealm(root,hooks,realm.symbolRegistry,agent);
 const target=createConstructorObject<ScriptPropertyKey,unknown>(foreign.functionPrototype,(receiver,args):unknown=>undefined,(args,newTarget):unknown=>root);
 createDataProperty<ScriptPropertyKey,unknown>(target,"prototype",42,hooks);
 const fallback=constructObject<ScriptPropertyKey,unknown>(constructor,[executor],{object:target,value:target},undefined);
 const fallbackObject=viewObjectValue(fallback.value,root);
 if(fallbackObject===undefined||fallbackObject.prototype!==foreign.promisePrototype)return 9;
 const rejectedExecutor=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{throw 123;});
 const rejected=constructObject<ScriptPropertyKey,unknown>(constructor,[rejectedExecutor],{object:constructor,value:constructor},undefined);
 const rejectedObject=viewObjectValue(rejected.value,root);
 if(rejectedObject===undefined)return 7;
 const rejectedRecord=rejectedObject.internalExoticSlots?.internalPromiseData;
 if(rejectedRecord===undefined||rejectedRecord.state!=="rejected"||rejectedRecord.result!==123)return 8;
 return 42;
}`,
  "promise-intrinsics",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
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
