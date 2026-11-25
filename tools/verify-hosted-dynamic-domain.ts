import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `import {createObject,createErrorRealm,installFunctionIntrinsics,getProperty,callObjectValue,createRuntimeError,type ScriptPropertyKey,type ObjectHooks} from "objects";
import {createGlobalEnvironment} from "global";
import {createDynamicFunctionCompiler} from "engine";
export function run():number{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,object);if(result.error!=="none")throw "call";return result.value;}};
 const realm=createErrorRealm(object,hooks);installFunctionIntrinsics(object,realm,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const state={domain:17,published:0,invoked:0};
 // Deliberate sentinel host: no code pointer is invoked. This tests the compiled
 // ownership guards, independently of the real-JIT positive regression cases.
 const compiler=createDynamicFunctionCompiler({realm,global,object,hooks},{
  domain:():number=>state.domain,
  storage:{domain:17,publish:(bytes:Uint8Array):number|undefined=>{state.published++;return 4096;}},
  invokeBorrowed:(address:number,value:unknown):unknown=>{state.invoked++;return value;},
  invokeManaged:(address:number,reader:(base:unknown,step:number)=>unknown):unknown=>{state.invoked++;throw "FOREIGN_CALL";},
  descriptor:(reader:(base:unknown,step:number)=>unknown):number=>{throw "DESCRIPTOR";},
  signature:(reader:(base:unknown,step:number)=>unknown):number=>{throw "SIGNATURE";},
  readWord:(address:number,byteLength:number,offset:number):number=>{throw "READ";},
 },{maxDynamicCodeBytes:65536});
 const target=getProperty<ScriptPropertyKey,unknown>(object,"Function",object,hooks);
 const fn=compiler("normal",["value"],"return value",target);
 const result=callObjectValue(fn,undefined,[42],object);if(result.error!=="none"||result.value!==42||state.published!==1||state.invoked!==1)return 1;
 state.domain=19;let rejected=false;try{callObjectValue(fn,undefined,[23],object);}catch(error){rejected=realm.unsupported;}
 if(!rejected||state.invoked!==1||state.published!==1)return 2;
 return 42;
}`,
  "dynamic-domain",
  [
    ["objects", objects],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["engine", "packages/js-engine/src/dynamic-function.ts"],
  ],
  [],
  [
    { module: objects, name: "viewObjectValue", operation: "view" },
    { module: objects, name: "viewSymbolValue", operation: "view" },
    { module: objects, name: "viewBigIntValue", operation: "view" },
    { module: objects, name: "viewWeakRegistryOwner", operation: "view" },
  ],
  [
    {
      module: objects,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
        "viewWeakRegistryOwner",
      ],
    },
  ],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);
