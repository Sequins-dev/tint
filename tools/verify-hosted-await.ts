import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createErrorRealm,createSourceAsyncContinuationFunction,createPromiseObject,createScriptPromiseHooks,installPromiseIntrinsics,callObjectValue,viewObjectValue,createDataProperty,createAccessorProperty,drainScriptJobs,runScriptContext,type GeneratorContinuation,type GeneratorOutcome,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "object";
import {createResolvingFunctions} from "protocol";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw 99;return result.value;}};
 const realm=createErrorRealm(root,hooks);
 installPromiseIntrinsics(root,realm,hooks,(promise,operation):void=>{});
 const protocol=createScriptPromiseHooks(realm,hooks,(promise,operation):void=>{});
 let calls=0;
 const fn=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(realm.agent,{realm,scriptOrModule:42},():OrdinaryObject<ScriptPropertyKey,unknown>=>createSourceAsyncContinuationFunction((receiver,args,callee,newTarget):GeneratorContinuation=>{
   if(newTarget!==undefined)throw 99;
   let step=0;
   return (kind,value):GeneratorOutcome<unknown>=>{
     calls++;
     const active=realm.agent.activeContext;
     if(active===undefined||active.scriptOrModule!==42||active.realm!==realm)throw 99;
     if(step===0){step++;return {kind:"yield",result:args[0]};}
     if(kind==="throw")return {kind:"return",value:42};
     return {kind:"return",value};
   };
 },realm,hooks,"f",1));
 const first=viewObjectValue(callObjectValue(fn,undefined,[42],root).value,root);
 if(first===undefined)return 1;
 const firstRecord=first.internalExoticSlots?.internalPromiseData;
 if(firstRecord===undefined||firstRecord.state!=="pending"||calls!==1)return 2;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 3;
 if(firstRecord.state!=="fulfilled"||firstRecord.result!==42||calls!==2)return 4;
 const awaited=createPromiseObject(realm.promisePrototype),record=awaited.internalExoticSlots?.internalPromiseData;
 if(record===undefined)return 5;
 createResolvingFunctions<unknown>(record,protocol).resolve(42);
 createDataProperty<ScriptPropertyKey,unknown>(awaited,"then",19,hooks);
 const second=viewObjectValue(callObjectValue(fn,undefined,[awaited],root).value,root);
 if(second===undefined)return 6;
 const secondRecord=second.internalExoticSlots?.internalPromiseData;
 if(secondRecord===undefined||secondRecord.state!=="pending")return 7;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 8;
 if(secondRecord.result!==42||secondRecord.state!=="fulfilled")return 9;
 const rejected=createPromiseObject(realm.promisePrototype),rejectedRecord=rejected.internalExoticSlots?.internalPromiseData;
 if(rejectedRecord===undefined)return 10;
 createResolvingFunctions<unknown>(rejectedRecord,protocol).reject(19);
 const third=viewObjectValue(callObjectValue(fn,undefined,[rejected],root).value,root);
 if(third===undefined)return 11;
 const thirdRecord=third.internalExoticSlots?.internalPromiseData;if(thirdRecord===undefined||!rejectedRecord.handled)return 12;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 13;
 if(thirdRecord.result!==42||thirdRecord.state!=="fulfilled")return 14;
 const getter=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{throw 19;});
 createAccessorProperty<ScriptPropertyKey,unknown>(awaited,"constructor",getter,false,hooks);
 const fourth=viewObjectValue(callObjectValue(fn,undefined,[awaited],root).value,root);
 if(fourth===undefined)return 15;
 const fourthRecord=fourth.internalExoticSlots?.internalPromiseData;
 if(fourthRecord===undefined||fourthRecord.state!=="fulfilled"||fourthRecord.result!==42)return 16;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==0)return 17;
 if(realm.agent.activeContext!==undefined)return 18;
 const foreignRoot=createObject<ScriptPropertyKey,unknown>(undefined);
 const foreign=createErrorRealm(foreignRoot,hooks,realm.symbolRegistry,realm.agent);
 installPromiseIntrinsics(foreignRoot,foreign,hooks,(promise,operation):void=>{});
 const foreignProtocol=createScriptPromiseHooks(foreign,hooks,(promise,operation):void=>{});
 const foreignPromise=createPromiseObject(foreign.promisePrototype),foreignRecord=foreignPromise.internalExoticSlots?.internalPromiseData;
 if(foreignRecord===undefined)return 19;
 createResolvingFunctions<unknown>(foreignRecord,foreignProtocol).resolve(42);
 const fifth=viewObjectValue(callObjectValue(fn,undefined,[foreignPromise],root).value,root);
 if(fifth===undefined)return 20;
 const fifthRecord=fifth.internalExoticSlots?.internalPromiseData;
 if(fifthRecord===undefined||fifthRecord.state!=="pending")return 21;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==3)return 22;
 if(fifthRecord.state!=="fulfilled"||fifthRecord.result!==42)return 23;
 const pending=createPromiseObject(realm.promisePrototype),pendingRecord=pending.internalExoticSlots?.internalPromiseData;
 if(pendingRecord===undefined)return 24;
 const settlement=createResolvingFunctions<unknown>(pendingRecord,protocol);
 const sixth=viewObjectValue(callObjectValue(fn,undefined,[pending],root).value,root);
 if(sixth===undefined)return 25;
 const sixthRecord=sixth.internalExoticSlots?.internalPromiseData;
 if(sixthRecord===undefined||sixthRecord.state!=="pending")return 26;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==0)return 27;
 runScriptContext<unknown>(realm.agent,{realm:foreign,scriptOrModule:99},():unknown=>{settlement.resolve(42);return undefined;});
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 28;
 if(sixthRecord.state!=="fulfilled"||sixthRecord.result!==42||realm.agent.activeContext!==undefined)return 29;
 return 42;
}`,
  "await",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["protocol", "packages/js-runtime/src/promises/index.ts"],
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
