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
} from "./workspace-sources.ts";

const output = process.argv[2];
if (!output)
  throw Error(
    "usage: node tools/verify-native-function-identities.ts <new-output-directory>",
  );
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const text = `import {nativeFunctionDescriptor,nativeFunctionSignature,readMemoryWord} from "memory";
function make(value:unknown):()=>unknown{return ():unknown=>value;}
function churn():void{for(let i=0;i<80;i++){const garbage=new Uint32Array(100);garbage[0]=i;if(garbage[0]!==i)throw "ALLOCATION";}}
export function run():number {
 const object={value:42}, first=make(42),second=make(object),third=make(undefined);
 const descriptor=nativeFunctionDescriptor(first),signature=nativeFunctionSignature(first);
 if(!Number.isSafeInteger(descriptor)||descriptor<=0||!Number.isSafeInteger(signature)||signature<=0)return 1;
 if(nativeFunctionDescriptor(second)!==descriptor||nativeFunctionDescriptor(third)!==descriptor)return 2;
 if(nativeFunctionSignature(second)!==signature||nativeFunctionSignature(third)!==signature)return 3;
 if(readMemoryWord(descriptor,32,0)!==48||readMemoryWord(descriptor,32,8)!==1||readMemoryWord(descriptor,32,16)!==24||readMemoryWord(descriptor,32,24)!==0)return 4;
 if(readMemoryWord(signature,32,0)!==1||readMemoryWord(signature,32,8)!==32||readMemoryWord(signature,32,16)!==0||readMemoryWord(signature,32,24)!==1)return 5;
 for(let i=0;i<12;i++){
  churn();
  if(nativeFunctionDescriptor(first)!==descriptor||nativeFunctionSignature(first)!==signature)return 6;
  if(nativeFunctionDescriptor(second)!==descriptor||nativeFunctionSignature(second)!==signature)return 7;
  if(first()!==42||second()!==object||third()!==undefined)return 8;
 }
 return 42;
}`;
const snapshot = workspaceSources(),
  bytes = new TextEncoder().encode(text),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules([...projectRoots(), memory], snapshot),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([["memory", memory]]),
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
  managedBytes: 8192,
  allocationCapacity: 256,
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
const path = resolve(output, "native-function-identities");
writeFileSync(path, built.value, { flag: "wx", mode: 0o755 });
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      kind: "native-function-identity-fixture",
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      path,
      expectedExitStatus: 42,
      source: text,
      scope:
        "Trusted same-program descriptor/signature reflection; captured unknown values and function identities survive repeated copying collection. No cross-image calls or public Script capability.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(path);
