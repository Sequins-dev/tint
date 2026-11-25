import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  createScriptRuntimeRequest,
  scriptEntryFrameModule,
  scriptRuntimeDependencies as scriptDependencies,
} from "./script-runtime-request.ts";
const frameMode = process.argv.includes("--script-frame");
const scriptMode = frameMode || process.argv.includes("--script-surface");
const scriptRequests = scriptMode
  ? [
      createScriptRuntimeRequest(
        { module: "surface-helpers", name: "bindScript" },
        frameMode,
      ),
    ]
  : [];
const helperDependencies = new Map<string, string>([
  ["contracts", "packages/compiler/src/native/index.ts"],
]);

const helpers = parseModule(
  createSourceTextView(`
import type {ManagedSurfaceExport} from 'contracts';
export interface Link{readonly value:number;readonly next:Link|undefined;}
export interface Table{readonly identity:(value:number)=>number;readonly count:()=>number;readonly created:()=>number;readonly visit:(value:Link,read:(node:Link)=>number)=>number;}
let initializations=0;function initialize():number{initializations++;return 0;}const initial=initialize();
let calls=0;
export function identity<T>(value:T):T{calls++;return value;}
export function count():number{return calls+initial;}
export function created():number{return initializations;}
export function visit(value:Link,read:(node:Link)=>number):number{return read(value);}
export function bind():ManagedSurfaceExport{throw 'MANAGED_SURFACE_UNBOUND';}
${scriptMode ? "export function bindScript():ManagedSurfaceExport{throw 'MANAGED_SURFACE_UNBOUND';}" : ""}
export function view(value:unknown):Table|undefined{throw 'UNBOUND_SURFACE_VIEW';}
`),
);
assert.ok(helpers.ok, JSON.stringify(helpers));
verifyHostedFixture(
  `
import {identity,count,created,bind,view,type Link${scriptMode ? ",bindScript" : ""}} from 'helpers';
import {readManagedSurfaceDirectory} from 'contracts';
import {nativeValueFunctionDescriptor,nativeValueFunctionSignature,currentContextDomain} from 'memory';
export function run():number{
 ${scriptMode ? `const script=bindScript();const scriptRead=readManagedSurfaceDirectory(script,'scriptRuntime',{domain:():number=>currentContextDomain(),descriptor:(value:unknown):number=>nativeValueFunctionDescriptor(value),signature:(value:unknown):number=>nativeValueFunctionSignature(value)});if(!scriptRead.ok||script.entries.length!==710||scriptRead.value.runtimes.length!==355)return 27;` : ""}
 ${
   frameMode
     ? `const boundScript=script;if(boundScript.directory.frame!=="ScriptEntryFrame")return 28;
 const framed=scriptRead;if(!framed.ok)return 29;
 const graph=framed.value.contracts.checked;
 const exportedFrame=framed.value.contracts.surface.types.find(item=>item!==undefined&&item.name==="ScriptEntryFrame");if(exportedFrame===undefined)return 30;
 const named=exportedFrame.type;if(named.kind!=="named")return 31;const frameId=graph.typeNames.get(named.name);if(frameId===undefined)return 32;
 const shape=graph.types[frameId];if(shape===undefined||shape.kind!=="object"||shape.properties.length!==3)return 33;
 for(let index=0;index<shape.properties.length;index++){const property=shape.properties[index];if(property===undefined||!property.readonly||property.optional||property.name!==(index===0?"$imports":"$argument"+String(index-1)))return 34;const type=graph.types[property.type];if(type===undefined||type.kind!==(index===0?"unknown":"object"))return 35;}`
     : ""
 }
 if(created()!==1||identity<number>(19)!==19||count()!==1)return 1;
 const first=bind(),second=bind();
 if(first===second||first.table===second.table||first.directory===second.directory)return 2;
 const a=view(first.table),b=view(second.table);
 if(a===undefined||b===undefined)return 3;
 if(a.identity!==b.identity||a.count!==b.count||a.created!==b.created||a.visit!==b.visit)return 4;
 if(a.identity(23)!==23||b.count()!==2||a.created()!==1)return 5;
 const link:Link={value:42,next:undefined};
 if(b.visit(link,(value:Link):number=>value.value)!==42)return 6;
 if(first.directory.version!==3||first.directory.name!=='sharedRuntime'||first.directory.digest.length!==64||first.directory.digest!==second.directory.digest)return 7;
 if(first.entries.length===0||first.entries.length!==second.entries.length)return 23;
 for(let i=0;i<first.entries.length;i++){const pointer=first.entries[i];if(pointer===undefined||!Number.isSafeInteger(pointer)||pointer<=0||pointer%4!==0||pointer!==second.entries[i])return 24;}
 if(first.functions.length<4||first.functions.length!==second.functions.length||first.records.length===0||first.records.length!==second.records.length)return 8;
 for(let i=0;i<first.functions.length;i++){if(first.functions[i]!==second.functions[i])return 9;}
 for(let i=0;i<first.records.length;i++){const pointer=first.records[i];if(pointer===undefined||!Number.isSafeInteger(pointer)||pointer<=0||pointer!==second.records[i])return 10;}
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 11;}
 if(a.identity(42)!==42||b.count()!==3||count()!==3||created()!==1)return 12;
 for(let i=0;i<first.functions.length;i++){if(first.functions[i]!==second.functions[i])return 13;}
 for(let i=0;i<first.records.length;i++){if(first.records[i]!==second.records[i])return 14;}
 const host={domain:():number=>currentContextDomain(),descriptor:(value:unknown):number=>nativeValueFunctionDescriptor(value),signature:(value:unknown):number=>nativeValueFunctionSignature(value)};
 const read=readManagedSurfaceDirectory(first,'sharedRuntime',host);if(!read.ok)return 15;
 const reread=readManagedSurfaceDirectory(second,'sharedRuntime',host);if(!reread.ok)return 16;
 if(read.value.runtimes.length*2!==first.entries.length||reread.value.runtimes.length!==read.value.runtimes.length)return 25;
 for(let i=0;i<read.value.runtimes.length;i++){const binding=read.value.runtimes[i];if(binding===undefined||binding.role!=='function-entry'||binding.entry!==first.entries[i*2]||binding.address!==first.entries[i*2+1]||binding.domain!==currentContextDomain())return 26;}
 if(read.value.domain<=0||read.value.domain!==currentContextDomain()||read.value.domain!==reread.value.domain||read.value.records.length!==first.records.length)return 17;
 const typed=new Uint32Array(2);typed[0]=19;
 const invalid:readonly unknown[]=[undefined,null,19,false,'text',{other:42},typed];
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 20;}
 if(invalid[6]!==typed||typed[0]!==19)return 21;
 for(const value of invalid){if(nativeValueFunctionDescriptor(value)!==-1||nativeValueFunctionSignature(value)!==-1)return 18;}
 if(nativeValueFunctionDescriptor(a.identity)!==read.value.brand.address||nativeValueFunctionSignature(a.identity)<=0)return 19;
 return 42;
}`,
  frameMode
    ? "script-frame-directory"
    : scriptMode
      ? "script-runtime-directory"
      : "managed-surface-directory",
  [
    ...(scriptMode ? scriptDependencies : []),
    ...(frameMode
      ? [["script-frame", scriptEntryFrameModule] as [string, string]]
      : []),
    ["helpers", "surface-helpers"],
    ["contracts", "packages/compiler/src/native/index.ts"],
    ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
  ],
  [
    {
      id: "surface-helpers",
      module: helpers.value,
      dependencies: helperDependencies,
    },
  ],
  [{ module: "surface-helpers", name: "view", operation: "view" }],
  [
    {
      module: "surface-helpers",
      namespace: "surface-view",
      retainedExports: ["view"],
    },
    {
      module: "packages/native-runtime/src/intrinsics/memory.ts",
      namespace: "surface-memory",
    },
  ],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
    hostBindings: [
      {
        module: "packages/native-runtime/src/intrinsics/memory.ts",
        name: "nativeValueFunctionDescriptor",
        operation: "native-value-function-descriptor",
      },
      {
        module: "packages/native-runtime/src/intrinsics/memory.ts",
        name: "nativeValueFunctionSignature",
        operation: "native-value-function-signature",
      },
      {
        module: "packages/native-runtime/src/intrinsics/memory.ts",
        name: "currentContextDomain",
        operation: "context-domain",
      },
    ],
    managedSurfaces: [
      ...scriptRequests,
      {
        name: "sharedRuntime",
        values: ["identity", "count", "created", "visit"].map((name) => ({
          module: "surface-helpers",
          name,
          typeArguments:
            name === "identity" ? [{ kind: "keyword", name: "number" }] : [],
        })),
        types: [],
        bind: { module: "surface-helpers", name: "bind" },
      },
    ],
  },
);
