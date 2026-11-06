import { verifyHostedFixture } from "./hosted-fixture.ts";
import { parsedNativeHost } from "./test262-native.ts";

const objects = "packages/js-runtime/src/objects/index.ts";
// A noncollecting heap bounds total allocation independently of host CPU share.
// Returning the existing allocator callback preserves the offset-based ABI.
const runtime = parsedNativeHost(
  "string-codepoints-region-runtime",
  `
import {createRegionAllocator} from "region";
import {initializeExternalMemory} from "external";
export function initializeRuntime(managedBase:number,managedLength:number,controlBase:number,controlLength:number,imageBase:number,imageLength:number,stackBase:number,stackLength:number,metadata:Uint32Array,offsets:Uint32Array,sizes:Uint32Array,starts:Float64Array,marks:Uint8Array,pending:Uint32Array,roots:Float64Array):(bytes:number)=>number|undefined {
 initializeExternalMemory(managedBase,managedLength,controlBase,controlLength,imageBase,imageLength,stackBase,stackLength);
 const region=createRegionAllocator(managedLength,16,metadata);
 if(region===undefined)throw "INVALID_PROBE_REGION";
 return region.allocate;
}`,
  new Map([
    ["region", "packages/native-runtime/src/allocators/region/index.ts"],
    ["external", "packages/native-runtime/src/external-memory.ts"],
  ]),
);

verifyHostedFixture(
  `
import {createObject,createErrorRealm,installPrimitiveIntrinsics,getOwnProperty,viewObjectValue,callObjectValue,type ObjectHooks,type ScriptPropertyKey} from "objects";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 installPrimitiveIntrinsics(root,realm,hooks);
 const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(root,"String");if(descriptor===undefined)return 1;
 const constructor=viewObjectValue(descriptor.value,realm.objectPrototype);if(constructor===undefined)return 2;
 const method=getOwnProperty<ScriptPropertyKey,unknown>(constructor,"fromCodePoint");if(method===undefined)return 3;
 const args:unknown[]=[];for(let i=0;i<10000;i++)args.push(65536+(i%4096));
 const result=callObjectValue(method.value,undefined,args,root);if(result.error!=="none")return 4;
 const text=result.value;if(typeof text!=="string"||text.length!==20000)return 5;
 if(text.charCodeAt(0)!==55296||text.charCodeAt(1)!==56320)return 6;
 if(text.charCodeAt(19998)!==55297||text.charCodeAt(19999)!==57103)return 7;
 return 42;
}`,
  "string-codepoints",
  [["objects", objects]],
  [runtime],
  ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
    module: objects,
    name,
    operation: "view" as const,
  })),
  [
    {
      module: objects,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    runtimeModule: runtime.id,
    runtimeEntry: "initializeRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    stackBytes: 16777216,
  },
);
