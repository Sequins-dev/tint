import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import type { NativeHostBinding } from "@tint/compiler/native";
import {
  workspaceSources,
  workspaceModules,
  workspaceSourceIdentity,
  readWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

const output = process.argv[2];
if (!output)
  throw Error(
    "usage: node tools/verify-native-managed-imports.ts <new-output-directory>",
  );
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const compiler = "packages/compiler/src/native/index.ts";
const emitter = "packages/codegen/src/aarch64/scalar/index.ts";
const ir = "packages/ir/src/scalar/index.ts";
const text = `import {nativeFunctionDescriptor,nativeFunctionSignature,readMemoryWord} from "memory";
import {resolveManagedPointers,type ManagedIdentityBinding} from "compiler";
import {emitModule} from "emitter";
import type {ModuleIR} from "ir";
function read(address:number,byteLength:number,offset:number):number{return readMemoryWord(address,byteLength,offset);}
function pointer(bytes:Uint8Array,offset:number):number{let value=0;for(let i=7;i>=0;i--){const byte=bytes[offset+i];if(byte===undefined)throw "POINTER";value=value*256+byte;}return value;}
export function run():number {
 const captured={value:42},callback=():unknown=>captured;
 const descriptor=nativeFunctionDescriptor(callback),signature=nativeFunctionSignature(callback);
 const noArguments:readonly number[]=[];
 const module:ModuleIR={functions:[
 {id:0,name:"entry",exported:true,parameters:[0],slots:["reference"],returnType:"general",entry:0,blocks:[{id:0,instructions:[{kind:"load",id:0,slot:0,start:0,end:0},{kind:"call-indirect",id:1,target:1,callee:0,arguments:noArguments,start:0,end:0}],terminator:{kind:"return",value:1,start:0,end:0}}]},
 {id:1,name:"witness",exported:false,parameters:[],slots:[],returnType:"general",entry:0,blocks:[{id:0,instructions:[{kind:"general-none",id:0,start:0,end:0}],terminator:{kind:"return",value:0,start:0,end:0}}]}
 ]};
 const emitted=emitModule(module,{managedABI:{version:1,functionBrand:{name:"brand",contract:"tint.function.v1"},signatures:[{witness:1,name:"reader",contract:"tint.test.captured-reader.v1",parameters:[],returnType:"general"}]}});
 if(!emitted.ok)return 1;
 const native=emitted.value;
 const bindings:readonly ManagedIdentityBinding[]=[
 {role:"function-brand",name:"brand",contract:"tint.function.v1",address:descriptor,byteLength:32,parameters:[],returnType:undefined},
 {role:"signature",name:"reader",contract:"tint.test.captured-reader.v1",address:signature,byteLength:32,parameters:[],returnType:"general"}
 ];
 const linked=resolveManagedPointers(native,bindings,read);if(!linked.ok)return 2;
 for(const item of native.managedImports){if(item===undefined)throw "IMPORT";if(pointer(native.code,item.offset)!==0)return 3;if(pointer(linked.value.code,item.offset)!==(item.role==="function-brand"?descriptor:signature))return 4;}
 const brandBinding=bindings[0],signatureBinding=bindings[1];if(brandBinding===undefined||signatureBinding===undefined)throw "BINDING";
 const wrong:readonly ManagedIdentityBinding[]=[brandBinding,{role:"signature",name:"reader",contract:"unrelated",address:signature,byteLength:32,parameters:[],returnType:"general"}];
 if(resolveManagedPointers(native,wrong,read).ok)return 5;
 for(let i=0;i<12;i++){for(let j=0;j<80;j++){const garbage=new Uint32Array(100);garbage[0]=j;if(garbage[0]!==j)throw "ALLOCATION";}}
 if(callback()!==captured||nativeFunctionDescriptor(callback)!==descriptor||nativeFunctionSignature(callback)!==signature)return 6;
 const again=resolveManagedPointers(native,bindings,read);if(!again.ok)return 7;
 return 42;
}`;
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
];
const built = buildMacOSProgram({
  ...request,
  allowDebugger: true,
  debugSymbols: true,
  runtimeEntry: "initializeCopyingRuntime",
  entry: "fixture",
  start: "run",
  denseReferenceLists: false,
  managedBytes: 8388608,
  allocationCapacity: 131072,
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
const path = resolve(output, "native-managed-imports");
writeFileSync(path, built.value, { flag: "wx", mode: 0o755 });
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      kind: "native-managed-import-fixture",
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      path,
      expectedExitStatus: 42,
      source: text,
      scope:
        "Emits symbolic managed imports inside native Tint and resolves full-width slots against trusted AOT function/signature identities. Contract rejection and repeated moving collections preserve source bytes and metadata identity. No generated code is invoked.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(path);
