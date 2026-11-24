import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,createSourceAsyncGeneratorFunction,installPromiseIntrinsics,callObjectValue,viewObjectValue,getProperty,drainScriptJobs,runScriptContext,type AsyncGeneratorContinuation,type AsyncGeneratorOutcome,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw 99;return result.value;}};
 const realm=createErrorRealm(root,hooks);
 installPromiseIntrinsics(root,realm,hooks,(promise,operation):void=>{});
 let initialized=0,called=0;
 const fn=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(realm.agent,{realm,scriptOrModule:42},():OrdinaryObject<ScriptPropertyKey,unknown>=>createSourceAsyncGeneratorFunction((receiver,args,callee):AsyncGeneratorContinuation<unknown>=>{
  initialized++;let step=0;
  return (kind,value):AsyncGeneratorOutcome<unknown>=>{
   called++;const active=realm.agent.activeContext;
   if(active===undefined||active.realm!==realm||active.scriptOrModule!==42)throw 99;
   step++;
   if(step===1){if(value!==undefined)throw 98;return {kind:"await",value:19};}
   if(step===2)return {kind:"yield",value};
   if(kind!=="return")throw 97;
   return {kind:"return",value};
  };
 },realm,hooks,"f",0));
 if(fn.internalConstruct!==undefined)return 1;
 const generator=viewObjectValue(callObjectValue(fn,undefined,[],root).value,root);
 if(generator===undefined||initialized!==1||called!==0)return 2;
 const next=getProperty<ScriptPropertyKey,unknown>(generator,"next",generator,hooks);
 const ret=getProperty<ScriptPropertyKey,unknown>(generator,"return",generator,hooks);
 const first=viewObjectValue(callObjectValue(next,generator,[99],root).value,root);
 const second=viewObjectValue(callObjectValue(ret,generator,[42],root).value,root);
 if(first===undefined||second===undefined||first===second)return 3;
 const a=first.internalExoticSlots?.internalPromiseData,b=second.internalExoticSlots?.internalPromiseData;
 if(a===undefined||b===undefined||a.state!=="pending"||b.state!=="pending"||called!==1)return 4;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==2)return 5;
 if(a.state!=="fulfilled"||b.state!=="fulfilled"||called!==3)return 6;
 const av=viewObjectValue(a.result,root),bv=viewObjectValue(b.result,root);
 if(av===undefined||bv===undefined)return 7;
 if(getProperty<ScriptPropertyKey,unknown>(av,"value",av,hooks)!==19||getProperty<ScriptPropertyKey,unknown>(av,"done",av,hooks)!==false)return 8;
 if(getProperty<ScriptPropertyKey,unknown>(bv,"value",bv,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(bv,"done",bv,hooks)!==true)return 9;
 const slot=generator.internalExoticSlots?.internalAsyncGeneratorData;
 if(slot===undefined||slot.record.continuation!==undefined||slot.record.state!=="completed")return 10;
 const bad=viewObjectValue(callObjectValue(next,root,[],root).value,root);
 if(bad===undefined)return 11;
 const badRecord=bad.internalExoticSlots?.internalPromiseData;if(badRecord===undefined||badRecord.state!=="rejected")return 12;
 const inherited=createObject<ScriptPropertyKey,unknown>(generator);
 const invalid=viewObjectValue(callObjectValue(next,inherited,[],root).value,root);
 if(invalid===undefined)return 13;
 const invalidRecord=invalid.internalExoticSlots?.internalPromiseData;if(invalidRecord===undefined||invalidRecord.state!=="rejected")return 14;
 const foreignRoot=createObject<ScriptPropertyKey,unknown>(undefined);
 const foreign=createErrorRealm(foreignRoot,hooks,realm.symbolRegistry,realm.agent);
 installPromiseIntrinsics(foreignRoot,foreign,hooks,(promise,operation):void=>{});
 const foreignNext=getProperty<ScriptPropertyKey,unknown>(foreign.asyncGeneratorPrototype,"next",foreign.asyncGeneratorPrototype,hooks);
 const complete=viewObjectValue(callObjectValue(foreignNext,generator,[],root).value,root);
 if(complete===undefined||complete.prototype!==foreign.promisePrototype)return 15;
 const completeRecord=complete.internalExoticSlots?.internalPromiseData;if(completeRecord===undefined||completeRecord.state!=="fulfilled")return 16;
 const cv=viewObjectValue(completeRecord.result,root);if(cv===undefined||cv.prototype!==foreign.objectPrototype)return 17;
 const fresh=viewObjectValue(callObjectValue(fn,undefined,[],root).value,root);if(fresh===undefined)return 18;
 const cross=viewObjectValue(callObjectValue(foreignNext,fresh,[],root).value,root);if(cross===undefined||cross.prototype!==foreign.promisePrototype)return 19;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 20;
 const crossRecord=cross.internalExoticSlots?.internalPromiseData;if(crossRecord===undefined||crossRecord.state!=="fulfilled")return 21;
 const crossResult=viewObjectValue(crossRecord.result,root);if(crossResult===undefined||crossResult.prototype!==realm.objectPrototype)return 22;
 if(realm.agent.activeContext!==undefined)return 23;
 const untouched=viewObjectValue(callObjectValue(fn,undefined,[],root).value,root);if(untouched===undefined)return 24;
 const before=called;
 const early=viewObjectValue(callObjectValue(ret,untouched,[42],root).value,root);if(early===undefined)return 25;
 const earlyRecord=early.internalExoticSlots?.internalPromiseData;if(earlyRecord===undefined||earlyRecord.state!=="pending")return 26;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1||called!==before)return 27;
 const earlyResult=viewObjectValue(earlyRecord.result,root);if(earlyResult===undefined||getProperty<ScriptPropertyKey,unknown>(earlyResult,"value",earlyResult,hooks)!==42)return 28;
 const throwing=getProperty<ScriptPropertyKey,unknown>(generator,"throw",generator,hooks);
 const rejected=viewObjectValue(callObjectValue(throwing,untouched,[19],root).value,root);if(rejected===undefined)return 29;
 const rejectedRecord=rejected.internalExoticSlots?.internalPromiseData;if(rejectedRecord===undefined||rejectedRecord.state!=="rejected"||rejectedRecord.result!==19)return 30;
 const untouchedThrow=viewObjectValue(callObjectValue(fn,undefined,[],root).value,root);if(untouchedThrow===undefined)return 31;
 const prethrow=viewObjectValue(callObjectValue(throwing,untouchedThrow,[23],root).value,root);if(prethrow===undefined)return 32;
 const prethrowRecord=prethrow.internalExoticSlots?.internalPromiseData;if(prethrowRecord===undefined||prethrowRecord.state!=="rejected"||prethrowRecord.result!==23||called!==before)return 33;
 return 42;
}`,
  "async-generator-objects",
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
