import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createObject,createCallableObject,createErrorRealm,installPromiseIntrinsics,createPromiseObject,createScriptPromiseHooks,getScriptAsyncIterator,createIteratorResult,createDataProperty,getProperty,wellKnownSymbol,callObjectValue,viewObjectValue,drainScriptJobs,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "object";
import {createResolvingFunctions} from "promises";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const r=callObjectValue(fn,receiver,args,root);if(r.error!=="none")throw 99;return r.value;}};
 const realm=createErrorRealm(root,hooks);installPromiseIntrinsics(root,realm,hooks,(promise,operation):void=>{});
 const protocol=createScriptPromiseHooks(realm,hooks,(promise,operation):void=>{});
 function settled(value:unknown,rejected:boolean):OrdinaryObject<ScriptPropertyKey,unknown>{
  const p=createPromiseObject(realm.promisePrototype),r=p.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(r===undefined)throw 99;
  const f=createResolvingFunctions<unknown>(r,protocol);if(rejected)f.reject(value);else f.resolve(value);return p;
 }
 const sync=createObject<ScriptPropertyKey,unknown>(root);
 let closed=0,arity=-1,rejecting=false;
 const next=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
  if(receiver!==sync)throw 98;arity=args.length;return createIteratorResult(settled(42,rejecting),false,realm,hooks);
 });
 createDataProperty<ScriptPropertyKey,unknown>(sync,"next",next,hooks);
 const iterable=createObject<ScriptPropertyKey,unknown>(root);
 createDataProperty<ScriptPropertyKey,unknown>(iterable,wellKnownSymbol(realm.symbolRegistry,"iterator"),createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>sync),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(iterable,wellKnownSymbol(realm.symbolRegistry,"asyncIterator"),null,hooks);
 const iterator=getScriptAsyncIterator(iterable,realm,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(sync,"next",19,hooks);
 const first=viewObjectValue(iterator.hooks.call(iterator.record.nextMethod,iterator.record.iterator,[]),root);if(first===undefined)return 1;
 const firstRecord=first.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(firstRecord===undefined||firstRecord.state!=="pending"||arity!==0)return 2;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 3;
 const firstResult=viewObjectValue(firstRecord.result,root);if(firstResult===undefined||firstRecord.state!=="fulfilled")return 4;
 if(getProperty<ScriptPropertyKey,unknown>(firstResult,"value",firstResult,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(firstResult,"done",firstResult,hooks)!==false)return 5;
 const argument=settled(19,false);
 const returned=iterator.hooks.get(iterator.record.iterator,"return");
 const second=viewObjectValue(iterator.hooks.call(returned,iterator.record.iterator,[argument]),root);if(second===undefined)return 6;
 const secondRecord=second.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(secondRecord===undefined||secondRecord.state!=="fulfilled")return 7;
 const secondResult=viewObjectValue(secondRecord.result,root);if(secondResult===undefined||getProperty<ScriptPropertyKey,unknown>(secondResult,"value",secondResult,hooks)!==argument)return 8;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==0)return 9;
 createDataProperty<ScriptPropertyKey,unknown>(sync,"return",createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{closed++;if(args.length!==0)throw 98;throw 19;}),hooks);
 rejecting=true;
 const third=viewObjectValue(iterator.hooks.call(iterator.record.nextMethod,iterator.record.iterator,[undefined]),root);if(third===undefined||arity!==1)return 10;
 const thirdRecord=third.internalRareSlots?.internalExoticSlots?.internalPromiseData;if(thirdRecord===undefined)return 11;
 if(drainScriptJobs(realm.agent,(e):void=>{throw e;})!==1)return 12;
 if(thirdRecord.state!=="rejected"||thirdRecord.result!==42||closed!==1)return 13;
 const asyncObject=createObject<ScriptPropertyKey,unknown>(root);createDataProperty<ScriptPropertyKey,unknown>(asyncObject,"next",23,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(iterable,wellKnownSymbol(realm.symbolRegistry,"asyncIterator"),createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>asyncObject),hooks);
 const direct=getScriptAsyncIterator(iterable,realm,hooks);
 if(direct.record.iterator!==asyncObject||direct.record.nextMethod!==23)return 14;
 createDataProperty<ScriptPropertyKey,unknown>(iterable,wellKnownSymbol(realm.symbolRegistry,"asyncIterator"),42,hooks);
 let caught=0;try{getScriptAsyncIterator(iterable,realm,hooks);}catch{caught++;}if(caught!==1)return 15;
 return 42;
}`,
  "async-iteration",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["promises", "packages/js-runtime/src/promises/index.ts"],
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
