import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import type { NativeHostBinding } from "@tint/compiler/native";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import {
  workspaceSources,
  workspaceModules,
  workspaceSourceIdentity,
  readWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

const output = process.argv[2];
if (!output)
  throw Error(
    "usage: node tools/verify-native-managed-invocation.ts <new-output-directory>",
  );
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const compiler = "packages/compiler/src/native/index.ts";
const emitter = "packages/codegen/src/aarch64/scalar/index.ts";
const ir = "packages/ir/src/scalar/index.ts";
const invocationModule: ModuleIR = {
  records: [
    {
      byteLength: 48,
      fields: [
        {
          offset: 16,
          type: "reference",
          mutable: false,
        },
        {
          offset: 24,
          type: "general",
          mutable: false,
        },
      ],
    },
  ],
  functions: [
    {
      id: 0,
      name: "entry",
      slots: ["reference", "general"],
      parameters: [0],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            {
              kind: "load",
              id: 0,
              slot: 0,
              start: 0,
              end: 0,
            },
            {
              kind: "general-none",
              id: 1,
              start: 0,
              end: 0,
            },
            {
              kind: "record-new",
              id: 2,
              record: 0,
              arguments: [0, 1],
              start: 0,
              end: 0,
            },
            {
              kind: "call-indirect",
              id: 3,
              target: 1,
              callee: 0,
              arguments: [],
              start: 0,
              end: 0,
            },
            {
              kind: "record-read",
              id: 4,
              object: 2,
              record: 0,
              field: 0,
              start: 0,
              end: 0,
            },
            {
              kind: "general-wrap",
              id: 5,
              value: 0,
              start: 0,
              end: 0,
            },
            {
              kind: "general-wrap",
              id: 6,
              value: 4,
              start: 0,
              end: 0,
            },
            {
              kind: "general-equal",
              id: 7,
              left: 5,
              right: 6,
              start: 0,
              end: 0,
            },
            {
              kind: "store",
              slot: 1,
              value: 3,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "branch",
            condition: 7,
            consequent: 1,
            alternate: 2,
            start: 0,
            end: 0,
          },
        },
        {
          id: 1,
          instructions: [
            {
              kind: "load",
              id: 8,
              slot: 1,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "return",
            value: 8,
            start: 0,
            end: 0,
          },
        },
        {
          id: 2,
          instructions: [],
          terminator: {
            kind: "throw-literal",
            value: "CANONICAL_RECORD_IDENTITY",
            start: 0,
            end: 0,
          },
        },
      ],
      exported: true,
    },
    {
      id: 1,
      name: "witness",
      slots: [],
      parameters: [],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            {
              kind: "general-none",
              id: 0,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "return",
            value: 0,
            start: 0,
            end: 0,
          },
        },
      ],
      exported: false,
    },
  ],
};
const canonicalInvocationModule: ModuleIR = {
  ...invocationModule,
  functions: [
    ...invocationModule.functions,
    {
      id: 2,
      name: "makeFrame",
      exported: true,
      parameters: [0],
      slots: ["reference"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
            { kind: "general-none", id: 1, start: 0, end: 0 },
            {
              kind: "record-new",
              id: 2,
              record: 0,
              arguments: [0, 1],
              start: 0,
              end: 0,
            },
            { kind: "general-wrap", id: 3, value: 2, start: 0, end: 0 },
          ],
          terminator: { kind: "return", value: 3, start: 0, end: 0 },
        },
      ],
    },
  ],
};
const predicateModule: ModuleIR = {
  records: invocationModule.records ?? [],
  functions: [
    {
      id: 0,
      name: "isFrame",
      exported: true,
      parameters: [0],
      slots: ["general"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
            {
              kind: "general-record-is",
              id: 1,
              value: 0,
              record: 0,
              start: 0,
              end: 0,
            },
            { kind: "general-wrap", id: 2, value: 1, start: 0, end: 0 },
          ],
          terminator: { kind: "return", value: 2, start: 0, end: 0 },
        },
      ],
    },
  ],
};
assert.deepEqual(verify(canonicalInvocationModule), { ok: true });
assert.deepEqual(verify(predicateModule), { ok: true });
const text = `import {nativeFunctionDescriptor,nativeFunctionSignature,readMemoryWord,mapExecutableMemory,writeExecutableMemory,registerExternalMemory,registerStackMaps,callExecutableManaged,callExecutableValue,currentRootHead,currentContextDomain} from "memory";
import {resolveManagedPointers,type ManagedIdentityBinding} from "compiler";
import {emitModule} from "emitter";
import type {ModuleIR} from "ir";
function read(address:number,byteLength:number,offset:number):number{return readMemoryWord(address,byteLength,offset);}
function pointer(bytes:Uint8Array,offset:number):number{let value=0;for(let i=7;i>=0;i--){const byte=bytes[offset+i];if(byte===undefined)throw "POINTER";value=value*256+byte;}return value;}
function churn():void{for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)throw "ALLOCATION";}}
function make(value:unknown,shouldThrow:boolean):()=>unknown{return ():unknown=>{churn();if(shouldThrow)throw value;return value;};}
const progress:{phase:number}={phase:0};
function exercise():number {
 const domain=currentContextDomain();if(domain<=0)return 40;
 progress.phase=1;
 const captured={value:42},callback=make(captured,false);
 const descriptor=nativeFunctionDescriptor(callback),signature=nativeFunctionSignature(callback);
 const module:ModuleIR=${JSON.stringify(canonicalInvocationModule)};
 const emitted=emitModule(module,{generationalBarriers:true,managedABI:{version:1,functionBrand:{name:"brand",contract:"tint.function.v1"},signatures:[{witness:1,name:"reader",contract:"tint.test.captured-reader.v1",parameters:[],returnType:"general"}],records:[{witness:0,name:"frame",contract:"tint.test.managed-frame.v1"}]}});
 if(!emitted.ok)return 1;
 const native=emitted.value;
 const arenaBytes=65536,arena=mapExecutableMemory(arenaBytes),descriptorOffset=arenaBytes-40;
 if(arena<=0||registerExternalMemory(arena,arenaBytes)!==0)return 8;
 if(native.code.length>descriptorOffset)return 20;
 const frameBytes=new Uint8Array(40);frameBytes[0]=48;frameBytes[8]=1;frameBytes[16]=16;frameBytes[24]=1;frameBytes[32]=24;
 if(writeExecutableMemory(arena,arenaBytes,descriptorOffset,frameBytes)!==0)return 21;
 const frameBinding:ManagedIdentityBinding={domain,role:"record",name:"frame",contract:"tint.test.managed-frame.v1",address:arena+descriptorOffset,byteLength:40,parameters:[],returnType:undefined,recordLayout:{byteLength:48,fields:[{offset:16,type:"reference",mutable:false},{offset:24,type:"general",mutable:false}]}};
 const bindings:readonly ManagedIdentityBinding[]=[
 {domain,role:"function-brand",name:"brand",contract:"tint.function.v1",address:descriptor,byteLength:32,parameters:[],returnType:undefined},
 {domain,role:"signature",name:"reader",contract:"tint.test.captured-reader.v1",address:signature,byteLength:32,parameters:[],returnType:"general"},frameBinding
 ];
 progress.phase=2;
 const linked=resolveManagedPointers(native,bindings,read,domain);if(!linked.ok)return 2;
 for(const item of native.managedImports){if(item===undefined)throw "IMPORT";if(pointer(native.code,item.offset)!==0)return 3;if(pointer(linked.value.code,item.offset)!==(item.role==="function-brand"?descriptor:item.role==="signature"?signature:frameBinding.address))return 4;}
 const brandBinding=bindings[0],signatureBinding=bindings[1];if(brandBinding===undefined||signatureBinding===undefined)throw "BINDING";
 const wrong:readonly ManagedIdentityBinding[]=[brandBinding,{domain,role:"signature",name:"reader",contract:"unrelated",address:signature,byteLength:32,parameters:[],returnType:"general"},frameBinding];
 if(resolveManagedPointers(native,wrong,read,domain).ok)return 5;
 progress.phase=3;
 if(writeExecutableMemory(arena,arenaBytes,0,linked.value.code)!==0)return 9;
 const nativeMaps=native.stackMaps[0];if(nativeMaps!==undefined&&registerStackMaps(arena,native.code.length,arena+nativeMaps.tableOffset)!==0)return 28;
 const entry=native.functions[0];if(entry===undefined)throw "ENTRY";
 const predicateInput:ModuleIR=${JSON.stringify(predicateModule)};
 const predicateEmission=emitModule(predicateInput,{generationalBarriers:true,managedABI:{version:1,functionBrand:{name:"brand",contract:"tint.function.v1"},signatures:[],records:[{witness:0,name:"frame",contract:"tint.test.managed-frame.v1"}]}});
 if(!predicateEmission.ok)return 22;
 const predicateNative=predicateEmission.value,predicateLinked=resolveManagedPointers(predicateNative,[brandBinding,frameBinding],read,domain);
 if(!predicateLinked.ok)return 23;
 const predicateOffset=Math.ceil(linked.value.code.length/16)*16;
 if(predicateOffset+predicateLinked.value.code.length>descriptorOffset)return 24;
 if(writeExecutableMemory(arena,arenaBytes,predicateOffset,predicateLinked.value.code)!==0)return 25;
 const predicateMaps=predicateNative.stackMaps[0];if(predicateMaps!==undefined&&registerStackMaps(arena+predicateOffset,predicateNative.code.length,arena+predicateOffset+predicateMaps.tableOffset)!==0)return 29;
 const maker=native.functions.find(fn=>fn!==undefined&&fn.id===2),predicate=predicateNative.functions[0];
 if(maker===undefined||predicate===undefined)throw "CANONICAL_ENTRY";
 const frame=callExecutableManaged(arena+maker.offset,callback),predicateAddress=arena+predicateOffset+predicate.offset;
 if(callExecutableValue(predicateAddress,frame)!==true||callExecutableValue(predicateAddress,captured)!==false)return 26;
 churn();
 if(callExecutableValue(predicateAddress,frame)!==true)return 27;
 const address=arena+entry.offset,head=currentRootHead();
 progress.phase=4;
 const returned=callExecutableManaged(address,callback);
 if(currentRootHead()!==head||returned!==captured)return 10;
 progress.phase=5;
 churn();if(returned!==captured)return 11;
 progress.phase=6;
 const nothing=make(undefined,false);if(callExecutableManaged(address,nothing)!==undefined)return 12;
 progress.phase=7;
 const number=make(42,false);if(callExecutableManaged(address,number)!==42)return 13;
 progress.phase=8;
 let caught:unknown=undefined;
 try{callExecutableManaged(address,make(captured,true));}catch(error){caught=error;}
 if(caught!==captured||currentRootHead()!==head)return 14;
 progress.phase=9;
 caught=undefined;try{callExecutableManaged(address,make(42,true));}catch(error){caught=error;}
 if(caught!==42||currentRootHead()!==head)return 15;
 progress.phase=10;
 const box:{value:unknown}={value:undefined};
 const fresh=():unknown=>{churn();const object={value:43};box.value=object;return object;};
 const created=callExecutableManaged(address,fresh);churn();if(created!==box.value)return 16;
 progress.phase=11;
 const nested=():unknown=>{churn();return callExecutableManaged(address,callback);};
 if(callExecutableManaged(address,nested)!==captured||currentRootHead()!==head)return 17;
 if(nativeFunctionDescriptor(callback)!==descriptor||nativeFunctionSignature(callback)!==signature)return 18;
 return 42;
}
export function run():number {try{return exercise();}catch(error){return (error==="ALLOCATION"?200:100)+progress.phase;}}`;
const sourceFlag = process.argv.indexOf("--sources");
const sourcePath = sourceFlag < 0 ? undefined : process.argv[sourceFlag + 1];
if (sourceFlag >= 0 && sourcePath === undefined)
  throw Error("--sources requires a frozen source file");
const snapshot =
    sourcePath === undefined
      ? workspaceSources()
      : readWorkspaceSourceSnapshot(sourcePath),
  bytes = new TextEncoder().encode(text),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules(
    [...projectRoots(), memory, compiler, emitter, ir],
    snapshot,
  ),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([
      ["memory", memory],
      ["compiler", compiler],
      ["emitter", emitter],
      ["ir", ir],
    ]),
  },
];
const request = projectBuildRequest(modules, () => {});
const grants: NativeHostBinding[] = [
  {
    module: memory,
    name: "nativeFunctionDescriptor",
    operation: "native-function-descriptor",
  },
  {
    module: memory,
    name: "nativeFunctionSignature",
    operation: "native-function-signature",
  },
  { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
  { module: memory, name: "mapExecutableMemory", operation: "executable-map" },
  {
    module: memory,
    name: "writeExecutableMemory",
    operation: "executable-write",
  },
  {
    module: memory,
    name: "registerExternalMemory",
    operation: "external-memory-register",
  },
  {
    module: memory,
    name: "registerStackMaps",
    operation: "stack-maps-register",
  },
  {
    module: memory,
    name: "callExecutableManaged",
    operation: "executable-call-managed",
  },
  {
    module: memory,
    name: "callExecutableValue",
    operation: "executable-call-value",
  },
  { module: memory, name: "currentRootHead", operation: "root-head" },
  { module: memory, name: "currentContextDomain", operation: "context-domain" },
];
const built = buildMacOSProgram({
  ...request,
  target: nativeFixtureTarget(),
  allowDebugger: true,
  allowJit: true,
  trustedExecutableCode: true,
  debugSymbols: true,
  runtimeEntry: "initializeGenerationalRuntime",
  entry: "fixture",
  start: "run",
  denseReferenceLists: false,
  managedBytes: 16777216,
  allocationCapacity: 262144,
  rootCapacity: 4096,
  stackBytes: 1048576,
  runtimes: [
    ...request.runtimes,
    { module: memory, namespace: "native-memory" },
  ],
  hostBindings: [...request.hostBindings, ...grants],
});
if (!built.ok) assert.fail(JSON.stringify(built.error));
mkdirSync(output);
const path = resolve(output, "native-managed-invocation");
writeFileSync(path, built.value, { flag: "wx", mode: 0o755 });
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      kind: "native-managed-invocation-fixture",
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      path,
      expectedExitStatus: 42,
      source: text,
      scope:
        "AOT to generated to AOT managed invocation with canonical imported record allocation and recognition across independent images before/after generational GC, retained callback identity across generational GC, and allocating callbacks, normal and thrown unknown payloads, nested calls, fresh object returns and root-chain restoration. Trusted canonical metadata linking and permanent publication only; no JavaScript source execution capability.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(path);
