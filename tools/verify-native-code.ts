import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import type { NativeHostBinding } from "@tint/compiler/native";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";

const output = process.argv[2];
if (!output)
  throw Error("usage: node tools/verify-native-code.ts <new-output-directory>");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  assembler = "packages/codegen/src/aarch64/isa.ts";
const compiler = "packages/compiler/src/native/index.ts",
  sourceText = "packages/source/src/text.ts",
  syntax = "packages/typescript/src/syntax/index.ts";
const target = nativeFixtureTarget(),
  linux = target.os === "linux";
// Linux arenas are dual mappings (docs/native-code-loading.md): a window must
// be a whole arena, and /proc/self/maps must show its two views of the
// memory file, never a writable and executable page. Where the kernel refuses
// executable memory files (run under tools/linux/refuse-executable-memfd.py
// with TINT_EXPECT_JIT_MAPPING=single) each arena is one anonymous
// read/execute mapping instead.
const expectedMapping = process.env.TINT_EXPECT_JIT_MAPPING ?? "dual";
if (expectedMapping !== "dual" && expectedMapping !== "single")
  throw Error("TINT_EXPECT_JIT_MAPPING must be dual or single");
const viewCounts =
  expectedMapping === "dual"
    ? "if(executableViews!==2||writableViews!==2||anonymousViews!==0)return 32;"
    : "if(executableViews!==0||writableViews!==0||anonymousViews!==2)return 32;";
const linuxChecks = linux
  ? `
 const views=mappings().split(String.fromCharCode(10));let executableViews=0,writableViews=0,anonymousViews=0;
 for(const view of views){if(view===undefined)return 32;if(view.indexOf(" rwx")>=0)return 32;if(view.indexOf("/memfd:tint-jit")>=0){if(view.indexOf(" r-xp ")>=0)executableViews++;else if(view.indexOf(" rw-s ")>=0)writableViews++;else return 32;}else if(view.indexOf(" r-xp 00000000 00:00 0")>=0&&view.indexOf("/")<0&&view.indexOf("[")<0)anonymousViews++;}
 ${viewCounts}
 if(writeExecutableMemory(small,16385,0,first)!==-1||writeExecutableMemory(address+64,size-64,0,first)!==-1)return 33;
 if(unmapExecutableMemory(address+16384,16)!==-22||unmapExecutableMemory(small,0)!==-22||unmapExecutableMemory(address+64,64)!==-22)return 34;
 if(mapExecutableMemory(1099511627777)!==-12)return 35;`
  : "";
const text = `import {mapExecutableMemory,writeExecutableMemory,callExecutableNumber,callExecutableValue,unmapExecutableMemory} from "memory";
import {openRead,read,close} from "fs";
import {writeInstruction,type Instruction} from "assembler";
import {createSourceTextView} from "source-text";
import {parseModule,parseScript,parseDynamicFunction} from "syntax";
import {compileClosedFunction,compileClosedDynamicFunction} from "compiler";
function compiled(text:string,arity:number,general:boolean):{bytes:Uint8Array;offset:number} {
 const source=createSourceTextView(text);
 const parsed=parseModule(source);if(!parsed.ok)throw "PARSE_FAILED";
 const compiled=compileClosedFunction(parsed.value,general?"identity":"run",16384);if(!compiled.ok)throw "COMPILATION_FAILED";
 const result=compiled.value;
 if(result.parameters.length!==arity||result.returnType!==(general?"general":"number"))throw "ENTRY_ABI";
 if(general&&result.parameters[0]!=="general")throw "ARGUMENT_ABI";
 return {bytes:result.native.code,offset:result.entry.offset};
}
function mappings():string {
 const path=new TextEncoder().encode("/proc/self/maps\\0"),fd=openRead(path);if(fd<0)return "";
 let text="";const buffer=new Uint8Array(4096);
 while(true){const count=read(fd,buffer);if(count<=0)break;for(let i=0;i<count;i++)text+=String.fromCharCode(buffer[i]??0);}
 close(fd);return text;
}
function code(value:number):Uint8Array {
 const instructions:Instruction[]=[{op:"movz",width:64,rd:9,immediate:value,shift:0},{op:"scvtf-d-x",rd:0,rn:9},{op:"str-d",rt:0,rn:3,offset:16},{op:"movz",width:32,rd:0,immediate:1,shift:0},{op:"str",width:32,rt:0,rn:3,offset:0},{op:"ret",rn:30}];
 const bytes=new Uint8Array(instructions.length*4);
 for(let i=0;i<instructions.length;i++){const instruction=instructions[i];if(instruction===undefined)throw "INSTRUCTION_INVARIANT";if(!writeInstruction(bytes,i*4,instruction).ok)throw "ENCODING_FAILED";}
 return bytes;
}
export function run():number {
 const view=createSourceTextView(String.fromCharCode(13)+String.fromCharCode(10)+"'"+String.fromCharCode(0xd800)+"';");
 const parsedInput=parseScript(view);if(!parsedInput.ok)return 17;
 const statement=parsedInput.value.statements[0];if(statement===undefined||statement.kind!=="expression")return 18;
 const literal=statement.expression;if(literal.kind!=="string"||literal.value.charCodeAt(0)!==0xd800)return 18;
 const position=view.positionAt(statement.start);if(!position.ok||position.value.line!==2||position.value.column!==1)return 19;
 const size=16384,address=mapExecutableMemory(size);if(address<=0)return 1;
 const first=code(42);if(writeExecutableMemory(address,size,0,first)!==0)return 2;
 if(callExecutableNumber(address)!==42)return 3;
 if(writeExecutableMemory(address,size,size,first)===0)return 4;
 for(const offset of [-1,0.5,2,0/0,1/0]){if(offset===undefined)return 16;if(writeExecutableMemory(address,size,offset,first)!==-1)return 12;}
 if(writeExecutableMemory(address,size,0,new Uint8Array(0))!==-1||writeExecutableMemory(address,size,0,new Uint8Array(1))!==-1)return 13;
 if(writeExecutableMemory(address,0,0,first)!==-1||writeExecutableMemory(0,size,0,first)!==-1)return 14;
 if(callExecutableNumber(address)!==42)return 15;
 const second=code(43);if(writeExecutableMemory(address,size,64,second)!==0)return 5;
 if(callExecutableNumber(address+64)!==43||callExecutableNumber(address)!==42)return 6;
 if(writeExecutableMemory(address,size,0,second)!==0||callExecutableNumber(address)!==43)return 7;
 const generated=compiled("export function run():number{let sum=0;for(let i=0;i<6;i++){sum+=i;}return sum+27;}",0,false);if(generated.bytes.length>size)return 8;
 if(writeExecutableMemory(address,size,0,generated.bytes)!==0)return 9;
 if(callExecutableNumber(address+generated.offset)!==42)return 10;
 const identity=compiled("export function identity(value:unknown):unknown{return value;}",1,true);
 if(identity.bytes.length>size||writeExecutableMemory(address,size,0,identity.bytes)!==0)return 20;
 const object={value:42};const values:unknown[]=[undefined,null,false,42,"text",object];
 for(const value of values){if(callExecutableValue(address+identity.offset,value)!==value)return 21;}
 const returned=callExecutableValue(address+identity.offset,object);
 const bodies=["return this;","'use strict';return this;","return 42;","return true;","return null;","","return;"];
 for(let i=0;i<bodies.length;i++){
  const body=bodies[i];if(body===undefined)return 23;
  const parsed=parseDynamicFunction("normal",[],body);if(!parsed.ok)return 24;
  const generated=compileClosedDynamicFunction(parsed.value,size);if(!generated.ok)return 25;
  if(generated.value.parameters.length!==1||generated.value.parameters[0]!=="general"||generated.value.returnType!=="general")return 26;
  if(writeExecutableMemory(address,size,0,generated.value.native.code)!==0)return 27;
  const value=callExecutableValue(address+generated.value.entry.offset,object);
  if(i<2?value!==object:i===2?value!==42:i===3?value!==true:i===4?value!==null:value!==undefined)return 28;
 }
 const small=mapExecutableMemory(100);if(small<=0)return 29;
 if(writeExecutableMemory(small,100,0,code(44))!==0||callExecutableNumber(small)!==44)return 30;
 if(mapExecutableMemory(0)>=0)return 31;${linuxChecks}
 if(unmapExecutableMemory(small,100)!==0)return 36;
 if(unmapExecutableMemory(address,size)!==0)return 11;
 if(returned!==object)return 22;
 return 42;
}`;
const snapshot = workspaceSources(),
  bytes = new TextEncoder().encode(text),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const fs = "packages/native-runtime/src/intrinsics/fs.ts";
const modules = [
  ...workspaceModules(
    [...projectRoots(), memory, fs, assembler, compiler, sourceText, syntax],
    snapshot,
  ),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([
      ["memory", memory],
      ["fs", fs],
      ["assembler", assembler],
      ["source-text", sourceText],
      ["syntax", syntax],
      ["compiler", compiler],
    ]),
  },
];
const request = projectBuildRequest(modules, () => {});
const grants: NativeHostBinding[] = [
  { module: memory, name: "mapExecutableMemory", operation: "executable-map" },
  {
    module: memory,
    name: "writeExecutableMemory",
    operation: "executable-write",
  },
  {
    module: memory,
    name: "callExecutableNumber",
    operation: "executable-call-number",
  },
  {
    module: memory,
    name: "callExecutableValue",
    operation: "executable-call-value",
  },
  {
    module: memory,
    name: "unmapExecutableMemory",
    operation: "executable-unmap",
  },
];
const built = buildMacOSProgram({
  ...request,
  target,
  allowDebugger: true,
  debugSymbols: true,
  allowJit: true,
  // Raw code capabilities do not yet have the managed-write proof required by
  // the generational mutator. Keep that restriction intact for this first slice.
  runtimeEntry: "initializeRuntime",
  denseReferenceLists: false,
  entry: "fixture",
  start: "run",
  managedBytes: 67108864,
  allocationCapacity: 1048576,
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
const path = resolve(output, "native-code");
writeFileSync(path, built.value, { flag: "wx", mode: 0o755 });
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      kind: "native-code-publication-fixture",
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      path,
      expectedExitStatus: 42,
      source: text,
      ...(linux ? { expectedJitMapping: expectedMapping } : {}),
      scope:
        "A native Tint program generates AArch64 instructions using Tint's assembler, publishes executable memory, invokes numeric entries and republishes code. It also parses, checks, lowers and emits numeric and unknown-value TypeScript functions inside native Tint, preserving borrowed managed identities through the standard ABI. General managed modules and eval scope semantics are not implemented by this fixture.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(path);
