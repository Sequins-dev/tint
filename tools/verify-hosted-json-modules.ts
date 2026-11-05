import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `
import {parseJSONModule,loadRequestedModules,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,resolveExport} from "modules";
import {createObject,createErrorRealm,getProperty,viewObjectValue,type ObjectHooks,type ScriptPropertyKey} from "objects";
const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>undefined};
export function run():number{
 const witness=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(witness,hooks);
 const bad=parseJSONModule("[1,]",realm,hooks,undefined);if(bad.ok)return 60;
 const error=viewObjectValue(bad.error,witness);if(error===undefined||error.prototype!==realm.prototypes.get("syntax"))return 61;
 const parsed=parseJSONModule('{"answer":42,"__proto__":7,"answer":43}',realm,hooks,"file.json");if(!parsed.ok)return 62;
 const module=parsed.module;if(module.hostDefined!=="file.json"||!module.synthetic)return 63;
 if(settledModulePromise(loadRequestedModules(module,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(module).ok)return 64;
 const namespace=getModuleNamespace(module);if(getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks)!==undefined)return 65;
 if(settledModulePromise(evaluateModule(module,hooks),realm).kind!=="fulfilled")return 66;
 const value=getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks),object=viewObjectValue(value,witness);if(object===undefined||object.prototype!==realm.objectPrototype)return 67;
 if(getProperty<ScriptPropertyKey,unknown>(object,"answer",object,hooks)!==43||getProperty<ScriptPropertyKey,unknown>(object,"__proto__",object,hooks)!==7||resolveExport(module,"answer",[])!==undefined)return 68;
 for(let i=0;i<200000;i++){const item:{n:number}={n:i};if(item.n!==i)return 69;}
 evaluateModule(module,hooks);if(getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks)!==value||getProperty<ScriptPropertyKey,unknown>(object,"answer",object,hooks)!==43)return 70;
 const lone=parseJSONModule('"'+String.fromCharCode(55296)+'"',realm,hooks,undefined);if(!lone.ok)return 71;
 if(settledModulePromise(loadRequestedModules(lone.module,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(lone.module).ok)return 72;
 evaluateModule(lone.module,hooks);const loneNamespace=getModuleNamespace(lone.module);if(getProperty<ScriptPropertyKey,unknown>(loneNamespace,"default",loneNamespace,hooks)!==String.fromCharCode(55296))return 73;
 return 42;
}`,
  "json-modules",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", objects],
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
      namespace: "json-module-views",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  { managedBytes: 4194304, allocationCapacity: 65536 },
);
