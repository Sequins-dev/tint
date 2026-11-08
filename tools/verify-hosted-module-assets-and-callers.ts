import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `
import {createTextModule,createBytesModule,loadRequestedModules,linkModule,evaluateModule,settledModulePromise,getModuleNamespace,type ModuleRecord} from "modules";
import {createObject,createErrorRealm,installArrayBufferIntrinsics,installTypedArrayIntrinsics,callObjectValue,getProperty,setProperty,viewObjectValue,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createSourceFunction} from "functions";
import {createSourceExecutionContext} from "jobs";
export function run():number{
 const witness=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a:unknown,b:unknown):boolean=>a===b,call:(callee:unknown,receiver:unknown,args:readonly unknown[]):unknown=>{const result=callObjectValue(callee,receiver,args,witness);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(witness,hooks);
 installArrayBufferIntrinsics(witness,realm,hooks);installTypedArrayIntrinsics(witness,realm,hooks,"little");
 const value=(module:ModuleRecord):unknown=>{
  if(settledModulePromise(loadRequestedModules(module,hooks,undefined),realm).kind!=="fulfilled"||!linkModule(module).ok)throw "FIXTURE_LINK";
  if(settledModulePromise(evaluateModule(module,hooks),realm).kind!=="fulfilled")throw "FIXTURE_EVALUATE";
  const namespace=getModuleNamespace(module);return getProperty<ScriptPropertyKey,unknown>(namespace,"default",namespace,hooks);
 };
 const text="\\ufeff\\ud800\\n",textModule=createTextModule(text,realm,undefined);if(value(textModule)!==text||value(textModule)!==text)return 1;
 const input=new Uint8Array([0,137,255]),bytes=createBytesModule(input,realm,hooks,undefined);if(!bytes.ok)return 2;
 const exported=value(bytes.module),array=viewObjectValue(exported,witness),data=array===undefined?undefined:array.internalTypedArrayData;
 if(array===undefined||data===undefined)return 3;const storage=data.storage;if(storage.kind!=="ordinary")return 3;if(!storage.immutable||storage.resizable)return 3;
 input[1]=4;const payload=storage.data;if(payload===undefined)return 4;if(payload[1]!==137||payload[2]!==255||data.length!==3)return 4;
 if(setProperty<ScriptPropertyKey,unknown>(array,"1",7,{object:array,value:exported},hooks)||value(bytes.module)!==exported)return 5;
 realm.bufferMaxBytes=1;if(createBytesModule(input,realm,hooks,undefined).ok)return 6;
 const inner=createSourceFunction((receiver,args,callee,newTarget):unknown=>{const fn=viewObjectValue(callee,witness);if(fn===undefined)throw "FIXTURE_FUNCTION";return getProperty<ScriptPropertyKey,unknown>(fn,"caller",callee,hooks);},true,realm,hooks,"inner",0,undefined,"legacy");
 const carrier=createSourceFunction((receiver,args,callee,newTarget):unknown=>hooks.call(inner,undefined,[]),false,realm,hooks,"carrier",0,undefined,"none");
 const outer=createSourceFunction((receiver,args,callee,newTarget):unknown=>hooks.call(carrier,undefined,[]),true,realm,hooks,"outer",0,undefined,"legacy");
 if(hooks.call(outer,undefined,[])!==outer||getProperty<ScriptPropertyKey,unknown>(inner,"caller",inner,hooks)!==null)return 7;
 const strict=createSourceFunction((receiver,args,callee,newTarget):unknown=>hooks.call(inner,undefined,[]),true,realm,hooks,"strict",0,undefined,"opaque");
 if(hooks.call(strict,undefined,[])!==null)return 8;
 const execution=createSourceExecutionContext(realm);
 const raw=createSourceFunction((receiver,args,callee,newTarget):unknown=>execution.run(():unknown=>hooks.call(inner,undefined,[])),true,realm,hooks,"raw",0,undefined,"legacy");
 if(hooks.call(raw,undefined,[])!==null||realm.agent.sourceCallDepth!==0)return 9;
 return 42;
}`,
  "module-assets-and-callers",
  [
    ["modules", "packages/js-runtime/src/modules/index.ts"],
    ["objects", objects],
    ["functions", "packages/js-runtime/src/objects/functions.ts"],
    ["jobs", "packages/js-runtime/src/objects/jobs.ts"],
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
      namespace: "module-assets-caller-views",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  { managedBytes: 16777216, allocationCapacity: 262144 },
);
