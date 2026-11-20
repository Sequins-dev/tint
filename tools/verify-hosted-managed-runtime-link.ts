import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
const x64 = nativeFixtureTarget().arch === "x86_64";
const linkSurface = x64
  ? "linkX64ManagedSurfaceModule"
  : "linkManagedSurfaceModule";
const resolvePointers = x64
  ? "resolveX64ManagedPointers"
  : "resolveManagedPointers";
const sparse = JSON.stringify(
  readFileSync("packages/foundation/src/collections/sparse-list.ts", "utf8"),
);
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const helpers = parseModule(
  createSourceTextView(`
import type {ManagedSurfaceExport} from "contracts";
export type Names=readonly string[];
export function names(value:Names):number{return value.length;}
export function make():string[]{return [];}
export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
`),
);
assert.ok(helpers.ok);
verifyHostedFixture(
  `
import {bind} from "helpers";
import {createSourceTextView} from "source";
import {parseModule,type Module,type ImportDeclaration,type Statement} from "syntax";
import {bindModule} from "binding";
import {linkModules,specializeModule} from "linking";
import {checkClosureModule} from "checker";
import {prepareCollectionRuntimes,runtimeFunctionIds} from "runtime";
import {lowerModuleEntries} from "lowering";
import {pruneClosedModule,optimizeModule} from "optimization";
import {emitModule} from "emitter";
import {readManagedSurfaceDirectory,${linkSurface} as linkManagedSurfaceModule,${resolvePointers} as resolveManagedPointers,selectManagedIdentityBindings} from "compiler";
import {managedRuntimeKeyForSurfaceType,managedRuntimeKeysForOptions,describeManagedRuntimeUses,finalFunctionSources,bindManagedRuntimeImports} from "selection";
import type {SourceModule} from "module-model";
import {nativeValueFunctionDescriptor,nativeValueFunctionSignature,currentContextDomain,readMemoryWord,mapExecutableMemory,registerExternalMemory,writeExecutableMemory,callExecutableManaged,currentRootHead${x64 ? ",registerStackMaps" : ""}} from "memory";
${x64 ? 'import {linuxX86_64Target} from "target";' : ""}
function parse(text:string):Module{const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)throw "PARSE";return parsed.value;}
function churn():void{for(let i=0;i<1024;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)throw "CHURN";}}
export function run():number {
 const exported=bind();
 const host={domain:():number=>currentContextDomain(),descriptor:(value:unknown):number=>nativeValueFunctionDescriptor(value),signature:(value:unknown):number=>nativeValueFunctionSignature(value)};
 const read=readManagedSurfaceDirectory(exported,"linkRuntime",host);if(!read.ok||read.value.runtimes.length*2!==exported.entries.length)return 1;
 const key=managedRuntimeKeyForSurfaceType(read.value.contracts,"Names");if(!key.ok)return 2;
 const sparseModule="sparse",jitModule="jit",imports:ImportDeclaration[]=[];
 for(const specifier of [sparseModule,jitModule]){if(specifier===undefined)throw "SPECIFIER";imports.push({start:0,end:0,specifier,specifierSpan:{start:0,end:0},bindings:[],typeOnly:false});}
 const statements:Statement[]=[];for(const declaration of imports){if(declaration===undefined)throw "IMPORT";statements.push({kind:"import",start:0,end:0,declaration});}
 const dependencies=new Map<string,string>();dependencies.set(sparseModule,sparseModule);dependencies.set(jitModule,jitModule);
 const jit=parse('export function entry(callback:()=>unknown):unknown{const values:string[]=[];for(let i=0;i<100000;i++)values.push("a");return values.length;}');
 const jitStatements:Statement[]=[];
 for(const alias of read.value.contracts.surface.declarations){if(alias===undefined||alias.kind!=="type-alias")throw "ALIAS";jitStatements.push({...alias,exported:true});}
 for(const statement of jit.statements){if(statement===undefined)throw "JIT_STATEMENT";jitStatements.push(statement);}
 const modules:SourceModule[]=[
 {id:sparseModule,module:parse(${sparse}),dependencies:new Map<string,string>()},
 {id:jitModule,module:{...jit,statements:jitStatements},dependencies:new Map<string,string>()},
 {id:"root",module:{start:0,end:0,imports,statements},dependencies}];
 const globals=["undefined","NaN","Infinity","Array","String","Boolean","Number","Math","Map","Set","Uint8Array","Uint16Array","Uint32Array","Float64Array","TypeError","RangeError"];
 const linked=linkModules(modules,"root",globals,{evaluation:"instance"});if(!linked.ok)return 3;
 const helperNames=new Map<string,string>();
 for(const item of linked.value.exports){if(item===undefined)throw "EXPORT";if(item.module===sparseModule&&item.namespace==="value")helperNames.set("sparse-list:"+item.name,item.linkedName);}
 const bound=bindModule(linked.value.module,globals);if(!bound.ok)return 4;
 const specialized=specializeModule(linked.value.module,bound.value,{maxSpecializations:4096});if(!specialized.ok)return 5;
 const checked=checkClosureModule(specialized.value.module);if(!checked.ok)return 6;
 const prepared=prepareCollectionRuntimes(linked.value.module,checked.value,helperNames,globals);if(!prepared.ok)return 7;
 const entryExport=linked.value.exports.find(item=>item!==undefined&&item.module===jitModule&&item.name==="entry");if(entryExport===undefined)return 8;
 const declaration=prepared.value.checked.module.statements.find(statement=>statement!==undefined&&statement.kind==="function"&&statement.name===entryExport.linkedName);if(declaration===undefined)return 9;
 const entry=prepared.value.checked.bindings.functions.find(fn=>fn!==undefined&&fn.node===declaration);if(entry===undefined)return 10;
 const lists=prepared.value.options.lists;if(lists===undefined||lists.length!==1||lists[0]?.element!=="string")return 11;
 const imported=runtimeFunctionIds(prepared.value.options);
 const lowered=lowerModuleEntries(prepared.value.checked,[entry.id],{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096,{...prepared.value.options,importedFunctions:imported});if(!lowered.ok)return 12;
 const root=lowered.value.entries.indexOf(entry.id);if(root<0)return 13;
 const first=pruneClosedModule(lowered.value.module,[root]);if(first===undefined)return 14;
 const optimized=optimizeModule(first.module),firstRoot=(first.functionIds[root]??0)-1;
 const second=pruneClosedModule(optimized.module,[firstRoot]);if(second===undefined)return 15;
 const sources=finalFunctionSources(lowered.value.entries,[first.functionIds,second.functionIds],second.module.functions.length);
 const aliases=new Map<string,number>();
 for(const item of linked.value.exports){if(item===undefined)throw "TYPE_EXPORT";if(item.module===jitModule&&item.namespace==="type"){const type=prepared.value.checked.typeNames.get(item.linkedName);if(type===undefined)throw "TYPE_ID";aliases.set(item.name,type);}}
 const keys=managedRuntimeKeysForOptions(read.value.directory,prepared.value.checked,aliases,prepared.value.options);if(!keys.ok||keys.value.lists[0]?.element!==key.value.element)return 16;
 const uses=describeManagedRuntimeUses(prepared.value.options,keys.value);if(!uses.ok)return 16;
 const bindings=bindManagedRuntimeImports(read.value.directory,second.module,sources,uses.value);if(!bindings.ok||bindings.value.length!==3)return 17;
 const finalRoot=(second.functionIds[firstRoot]??0)-1;
 const emitted=${
   x64
     ? 'emitModule(second.module,linuxX86_64Target.hostABI,true,true,false,[],false,false,{mode:"live",functions:[],records:[],bindings:{version:1,signatures:[],functions:bindings.value}})'
     : "emitModule(second.module,{closedRoots:[finalRoot],managedABI:{version:1,signatures:[],functions:bindings.value}})"
 };if(!emitted.ok)return 18;
 const native=emitted.value,nativeEntry=native.functions[finalRoot];if(nativeEntry===undefined||nativeEntry.import===true)return 19;
 const calls={count:0};
 const words=(address:number,length:number,offset:number):number=>{calls.count++;return readMemoryWord(address,length,offset);};
 const foreign=linkManagedSurfaceModule(read.value,native,words,currentContextDomain()+1);if(foreign.ok||calls.count!==0)return 20;
 const requests=native.managedImports;
 const wrong=requests.map(request=>({...request,contract:"missing"}));
 if(linkManagedSurfaceModule(read.value,{...native,managedImports:wrong},words,currentContextDomain()).ok||calls.count!==0)return 21;
 const selected=selectManagedIdentityBindings(read.value,requests);if(!selected.ok)return 22;
 const denied=resolveManagedPointers(native,selected.value,(address:number,length:number,offset:number):number=>{const value=words(address,length,offset);return offset===24?value+1:value;},currentContextDomain());if(denied.ok||calls.count===0)return 22;
 const linkedCode=linkManagedSurfaceModule(read.value,native,words,currentContextDomain());if(!linkedCode.ok)return 23;
 const capacity=Math.ceil((linkedCode.value.code.length+4095)/4096)*4096,arena=mapExecutableMemory(capacity);
 if(arena<=0||registerExternalMemory(arena,capacity)!==0||writeExecutableMemory(arena,capacity,0,linkedCode.value.code)!==0)return 24;
 ${x64 ? "const maps=native.stackMaps[0];if(maps===undefined||registerStackMaps(arena,native.code.length,arena+maps.tableOffset)!==0)return 27;" : ""}
 const head=currentRootHead(),callback=():unknown=>undefined;
 for(let repeat=0;repeat<8;repeat++){if(callExecutableManaged(arena+nativeEntry.offset,callback)!==100000||currentRootHead()!==head)return 25;}
 churn();
 if(callExecutableManaged(arena+nativeEntry.offset,callback)!==100000||currentRootHead()!==head)return 26;
 return 42;
}
`,
  "managed-runtime-link",
  [
    ["helpers", "runtime-link-helpers"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["selection", "packages/compiler/src/native/managed-runtime-selection.ts"],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["linking", "packages/ts-native/src/modules/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["runtime", "packages/ts-native/src/runtime/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
    ["module-model", "packages/typescript/src/modules/model.ts"],
    ["optimization", "packages/ir/src/optimization/index.ts"],
    [
      "emitter",
      x64
        ? "packages/codegen/src/x86_64/scalar/index.ts"
        : "packages/codegen/src/aarch64/scalar/index.ts",
    ],
    ...(x64
      ? ([["target", "packages/platform/src/target.ts"]] satisfies [
          string,
          string,
        ][])
      : []),
    ["memory", memory],
  ],
  [
    {
      id: "runtime-link-helpers",
      module: helpers.value,
      dependencies: new Map([
        ["contracts", "packages/compiler/src/native/index.ts"],
      ]),
    },
  ],
  [],
  [{ module: memory, namespace: "runtime-link-memory" }],
  {
    allowJit: true,
    runtimeEntry: x64
      ? "initializeGenerationalRuntime"
      : "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
    hostBindings: [
      {
        module: memory,
        name: "nativeValueFunctionDescriptor",
        operation: "native-value-function-descriptor",
      },
      {
        module: memory,
        name: "nativeValueFunctionSignature",
        operation: "native-value-function-signature",
      },
      {
        module: memory,
        name: "currentContextDomain",
        operation: "context-domain",
      },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
      {
        module: memory,
        name: "mapExecutableMemory",
        operation: "executable-map",
      },
      {
        module: memory,
        name: "registerExternalMemory",
        operation: "external-memory-register",
      },
      {
        module: memory,
        name: "writeExecutableMemory",
        operation: "executable-write",
      },
      {
        module: memory,
        name: "callExecutableManaged",
        operation: "executable-call-managed",
      },
      { module: memory, name: "currentRootHead", operation: "root-head" },
      ...(x64
        ? ([
            {
              module: memory,
              name: "registerStackMaps",
              operation: "stack-maps-register",
            },
          ] as const)
        : []),
    ],
    managedSurfaces: [
      {
        name: "linkRuntime",
        values: ["names", "make"].map((name) => ({
          module: "runtime-link-helpers",
          name,
          typeArguments: [],
        })),
        types: [
          { module: "runtime-link-helpers", name: "Names", typeArguments: [] },
        ],
        bind: { module: "runtime-link-helpers", name: "bind" },
      },
    ],
  },
);
