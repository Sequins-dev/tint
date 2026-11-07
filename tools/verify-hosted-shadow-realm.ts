import { verifyHostedFixture } from "./hosted-fixture.ts";
import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
const heartbeat = startNativeHeartbeat("native ShadowRealm runtime fixture");
try {
  heartbeat.phase("building wrapped calls and realm-local imports");
  const objects = "packages/js-runtime/src/objects/index.ts";
  verifyHostedFixture(
    `
import {createObject,createErrorRealm,createCallableObject,createDataProperty,callObjectValue,getProperty,viewObjectValue,constructObject,installShadowRealmIntrinsics,getShadowRealmWrappedValue,drainScriptJobs,type ScriptPropertyKey,type ObjectHooks,type ShadowRealmHost,type ShadowRealmEvaluation} from "objects";
import {createSyntheticModule,setSyntheticModuleExport,finishLoadingImportedModule} from "modules";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,root);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const outer=createErrorRealm(root,hooks),inner=createErrorRealm(root,hooks,outer.symbolRegistry,outer.agent);
 const callback=createCallableObject<ScriptPropertyKey,unknown>(outer.functionPrototype,(receiver,args):unknown=>42,outer.executionContext);
 const target=createCallableObject<ScriptPropertyKey,unknown>(inner.functionPrototype,(receiver,args):unknown=>{
  const value=viewObjectValue(args[0],root);if(value===undefined||value===callback||value.prototype!==inner.functionPrototype)throw "FIXTURE_WRAPPING";
  return value;
 },inner.executionContext);
 createDataProperty<ScriptPropertyKey,unknown>(target,"name","target",hooks);createDataProperty<ScriptPropertyKey,unknown>(target,"length",2.8,hooks);
 const wrappedValue=getShadowRealmWrappedValue(outer,target),wrapped=viewObjectValue(wrappedValue,root);
 if(wrapped===undefined||wrapped.prototype!==outer.functionPrototype||wrapped.internalConstruct!==undefined)return 1;
 if(getProperty<ScriptPropertyKey,unknown>(wrapped,"name",wrapped,hooks)!=="target"||getProperty<ScriptPropertyKey,unknown>(wrapped,"length",wrapped,hooks)!==2)return 2;
 if(getShadowRealmWrappedValue(outer,target)===wrappedValue)return 3;
 const returned=hooks.call(wrappedValue,undefined,[callback]);if(returned===callback||hooks.call(returned,undefined,[])!==42)return 4;
 let caught=false;try{hooks.call(wrappedValue,undefined,[root]);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===outer.prototypes.get("type");}if(!caught)return 5;
 const evaluate=(source:string):ShadowRealmEvaluation=>source==="bad"?{error:"syntax",value:undefined}:{error:"none",value:42};
 installShadowRealmIntrinsics(root,outer,hooks,():ShadowRealmHost=>({realm:inner,evaluate}));
 const constructorValue=getProperty<ScriptPropertyKey,unknown>(root,"ShadowRealm",root,hooks),constructor=viewObjectValue(constructorValue,root);if(constructor===undefined)return 6;
 const created=constructObject<ScriptPropertyKey,unknown>(constructor,[],{value:constructorValue,object:constructor},undefined),instance=viewObjectValue(created.value,root);if(instance===undefined||instance.prototype!==outer.shadowRealmPrototype)return 7;
 const method=getProperty<ScriptPropertyKey,unknown>(instance,"evaluate",instance,hooks);if(hooks.call(method,instance,["42"])!==42)return 8;
 caught=false;try{hooks.call(method,instance,["bad"]);}catch(error){const object=viewObjectValue(error,root);caught=object!==undefined&&object.prototype===outer.prototypes.get("syntax");}if(!caught)return 9;
 const module=createSyntheticModule(inner,["value"],(record):void=>{setSyntheticModuleExport(record,"value",42);},undefined);
 inner.moduleLoader=(referrer,request,host,payload):void=>{if(referrer.realm!==inner)throw "FIXTURE_IMPORT_REALM";finishLoadingImportedModule(referrer,request,payload,{ok:true,module});};
 const importValue=getProperty<ScriptPropertyKey,unknown>(instance,"importValue",instance,hooks),result=hooks.call(importValue,instance,["./entry.js","value"]),promise=viewObjectValue(result,root);
 if(promise===undefined||promise.prototype!==outer.promisePrototype)return 10;
 drainScriptJobs(outer.agent,(error):void=>{throw error;});const record=promise.internalPromiseData;
 if(record===undefined||record.state!=="fulfilled"||record.result!==42||outer.agent.activeContext!==undefined)return 11;
 return 42;
}`,
    "shadow-realm",
    [
      ["objects", objects],
      ["modules", "packages/js-runtime/src/modules/index.ts"],
    ],
    [],
    ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
      module: objects,
      name,
      operation: "view" as const,
    })),
    [
      {
        module: objects,
        namespace: "shadow-realm-views",
        retainedExports: [
          "viewObjectValue",
          "viewSymbolValue",
          "viewBigIntValue",
        ],
      },
    ],
    { managedBytes: 16777216, allocationCapacity: 262144 },
  );
} finally {
  await heartbeat.close();
}
