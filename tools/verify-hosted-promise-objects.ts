import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createDataProperty,defineOwnProperty,createErrorRealm,createScriptAgent,createSymbolRegistry,createPromiseObject,createScriptPromiseHooks,createScriptResolvingFunctions,callObjectValue,viewObjectValue,drainScriptJobs,runScriptContext,type ScriptPropertyKey,type ObjectHooks} from "object";
import {createResolvingFunctions,performPromiseThen} from "protocol";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw 99;return result.value;}};
 const agent=createScriptAgent();
 const a=createErrorRealm(root,hooks,createSymbolRegistry(),agent);
 const b=createErrorRealm(root,hooks,a.symbolRegistry,agent);
 const events:string[]=[];
 const adapter=createScriptPromiseHooks(a,hooks,(promise,operation):void=>{events.push(operation);});
 const promise=createPromiseObject(root),record=promise.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(record===undefined)return 1;
 const functions=createResolvingFunctions<unknown>(record,adapter);
 const pair=createScriptResolvingFunctions(functions,a,hooks);
 const thenable=createObject<ScriptPropertyKey,unknown>(root);
 let called=0,reads=0;
 const then=createCallableObject<ScriptPropertyKey,unknown>(b.functionPrototype,(receiver,args):unknown=>{
  called++;
  const active=agent.activeContext;
  if(active===undefined||active.realm!==b||active.scriptOrModule!==42||receiver!==thenable)throw 91;
  const resolve=viewObjectValue(args[0],root);
  if(resolve===undefined||resolve.prototype!==b.functionPrototype)throw 92;
  callObjectValue(args[0],undefined,[42],root);
  callObjectValue(args[1],undefined,[19],root);
  throw 23;
 });
 const getter=createCallableObject<ScriptPropertyKey,unknown>(a.functionPrototype,(receiver,args):unknown=>{reads++;return then;});
 defineOwnProperty<ScriptPropertyKey,unknown>(thenable,"then",{fields:4,value:undefined,writable:false,get:getter,set:undefined,enumerable:false,configurable:false},hooks);
 runScriptContext<unknown>(agent,{realm:a,scriptOrModule:42},():unknown=>{
  callObjectValue(pair.resolve,undefined,[thenable],root);
  if(reads!==1||called!==0||record.state!=="pending")throw 93;
  callObjectValue(pair.reject,undefined,[19],root);
  return undefined;
 });
 const observed:unknown[]=[];
 const handler=createCallableObject<ScriptPropertyKey,unknown>(a.functionPrototype,(receiver,args):unknown=>{
  const active=agent.activeContext;
  if(active===undefined||active.realm!==a||active.scriptOrModule!==42)throw 94;
  observed.push(args[0]);return 84;
 });
 const child=createPromiseObject(root),childRecord=child.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(childRecord===undefined)return 2;
 performPromiseThen<unknown>(record,handler,undefined,createResolvingFunctions<unknown>(childRecord,adapter),adapter);
 if(drainScriptJobs(agent,(error):void=>{throw error;})!==2)return 3;
 if(record.state!=="fulfilled"||record.result!==42||called!==1||reads!==1||observed[0]!==42||childRecord.result!==84)return 4;
 if(agent.activeContext!==undefined||events.length!==0)return 5;
 const cycle=createPromiseObject(root),cycleRecord=cycle.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(cycleRecord===undefined)return 6;
 const cyclePair=createScriptResolvingFunctions(createResolvingFunctions<unknown>(cycleRecord,adapter),b,hooks);
 callObjectValue(cyclePair.resolve,undefined,[cycle],root);
 const error=viewObjectValue(cycleRecord.result,root);
 if(error===undefined||error.prototype!==b.prototypes.get("type")||events[0]!=="reject")return 7;
 const catchError=createCallableObject<ScriptPropertyKey,unknown>(a.functionPrototype,(receiver,args):unknown=>{observed.push(args[0]);return undefined;});
 performPromiseThen<unknown>(cycleRecord,undefined,catchError,undefined,adapter);
 if(events[1]!=="handle")return 8;
 if(drainScriptJobs(agent,(error):void=>{throw error;})!==1||observed[1]!==error)return 9;
 const abrupt=createPromiseObject(root),abruptRecord=abrupt.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(abruptRecord===undefined)return 10;
 const badThenable=createObject<ScriptPropertyKey,unknown>(root);
 const badGetter=createCallableObject<ScriptPropertyKey,unknown>(b.functionPrototype,(receiver,args):unknown=>{throw 123;});
 defineOwnProperty<ScriptPropertyKey,unknown>(badThenable,"then",{fields:4,value:undefined,writable:false,get:badGetter,set:undefined,enumerable:false,configurable:false},hooks);
 createResolvingFunctions<unknown>(abruptRecord,adapter).resolve(badThenable);
 if(abruptRecord.state!=="rejected"||abruptRecord.result!==123||agent.jobs.size!==0)return 11;
 const plain=createPromiseObject(root),plainRecord=plain.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(plainRecord===undefined)return 12;
 const noncallable=createObject<ScriptPropertyKey,unknown>(root);
 createDataProperty<ScriptPropertyKey,unknown>(noncallable,"then",42,hooks);
 createResolvingFunctions<unknown>(plainRecord,adapter).resolve(noncallable);
 if(plainRecord.state!=="fulfilled"||plainRecord.result!==noncallable)return 13;
 const failedChild=createPromiseObject(root),failedRecord=failedChild.internalRareSlots?.internalExoticSlots?.internalPromiseData;
 if(failedRecord===undefined)return 14;
 performPromiseThen<unknown>(plainRecord,badGetter,undefined,createResolvingFunctions<unknown>(failedRecord,adapter),adapter);
 if(drainScriptJobs(agent,(error):void=>{throw error;})!==1||failedRecord.state!=="rejected"||failedRecord.result!==123)return 15;
 return 42;
}`,
  "promise-objects",
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
