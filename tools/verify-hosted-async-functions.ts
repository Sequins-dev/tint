import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createSourceAsyncFunction,installPromiseIntrinsics,installFunctionIntrinsics,callObjectValue,constructObject,viewObjectValue,drainScriptJobs,runScriptContext,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw 99;return result.value;}};
 const realm=createErrorRealm(root,hooks),events:string[]=[];
 installFunctionIntrinsics(root,realm,hooks);
 installPromiseIntrinsics(root,realm,hooks,(promise,operation):void=>{events.push(operation);});
 let called=0;
 const fn=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(realm.agent,{realm,scriptOrModule:42},():OrdinaryObject<ScriptPropertyKey,unknown>=>createSourceAsyncFunction((receiver,args,callee,newTarget):unknown=>{
   called++;
   const active=realm.agent.activeContext;
   if(active===undefined||active.scriptOrModule!==42||active.realm!==realm||newTarget!==undefined)throw 99;
   return args[0];
 },realm,hooks,"f",1));
 const first=callObjectValue(fn,root,[42],root);
 const promise=viewObjectValue(first.value,root);
 if(promise===undefined||promise.prototype!==realm.promisePrototype||called!==1)return 1;
 const record=promise.internalPromiseData;
 if(record===undefined||record.state!=="fulfilled"||record.result!==42)return 2;
 const adopting=createSourceAsyncFunction((receiver,args,callee,newTarget):unknown=>promise,realm,hooks);
 const second=callObjectValue(adopting,undefined,[],root),adopted=viewObjectValue(second.value,root);
 if(adopted===undefined||adopted===promise)return 3;
 const adoptedRecord=adopted.internalPromiseData;if(adoptedRecord===undefined||adoptedRecord.state!=="pending")return 4;
 drainScriptJobs(realm.agent,(error):void=>{throw error;});
 if(adoptedRecord.result!==42)return 5;
 const throwing=createSourceAsyncFunction((receiver,args,callee,newTarget):unknown=>{throw 19;},realm,hooks);
 const rejected=viewObjectValue(callObjectValue(throwing,undefined,[],root).value,root);
 if(rejected===undefined)return 6;
 const rejection=rejected.internalPromiseData;
 if(rejection===undefined||rejection.state!=="rejected"||rejection.result!==19||events[0]!=="reject")return 7;
 if(constructObject<ScriptPropertyKey,unknown>(fn,[],{object:fn,value:fn},undefined).error!=="type")return 8;
 if(realm.agent.activeContext!==undefined)return 9;
 return 42;
}`,
  "async-functions",
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
