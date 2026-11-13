// Native evidence for JIT code visibility (docs/runtime-diagnostics.md): a
// native Tint program compiles a TypeScript function with the in-image
// compiler, publishes it to MAP_JIT memory, registers it through the GDB/LLDB
// JIT interface (symbols plus DWARF lines) and a perf map, calls it and
// unregisters it. LLDB, with its JIT loader enabled, must resolve a pending
// breakpoint on the JIT function, stop in it with a symbolicated backtrace
// and source line, and the process must still exit 42.
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import type { NativeHostBinding } from "@tint/compiler/native";
import {
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";

const output = process.argv[2];
if (!output)
  throw Error(
    "usage: node tools/verify-hosted-jit-debug.ts <new-output-directory>",
  );
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  diagnostics = "packages/native-runtime/src/intrinsics/diagnostics.ts",
  fs = "packages/native-runtime/src/intrinsics/fs.ts",
  compiler = "packages/compiler/src/native/index.ts",
  sourceText = "packages/source/src/text.ts",
  syntax = "packages/typescript/src/syntax/index.ts",
  jitDebug = "packages/js-engine/src/native/jit-debug.ts";
const text = `import {mapExecutableMemory,writeExecutableMemory,callExecutableNumber,mapMemory,readMemoryWord,writeMemoryWord} from "memory";
import {writeMemoryBytes,jitDebugDescriptor,notifyJitDebugger,processId} from "diagnostics";
import {openExclusive,write,unlink} from "fs";
import {createSourceTextView} from "source-text";
import {parseModule} from "syntax";
import {compileClosedFunction} from "compiler";
import {createJitDebugRegistrar,type JitCodeFunction,type JitCodeLine} from "jit-debug";
function path(text:string):Uint8Array{const bytes=new TextEncoder().encode(text);const result=new Uint8Array(bytes.length+1);result.set(bytes);return result;}
export function run():number {
 const source="export function jitSum():number {\\n let sum=0;\\n for(let i=0;i<6;i++){sum+=i;}\\n return sum+27;\\n}\\n";
 const view=createSourceTextView(source);
 const parsed=parseModule(view);if(!parsed.ok)return 1;
 const compiled=compileClosedFunction(parsed.value,"jitSum",16384);if(!compiled.ok)return 2;
 const native=compiled.value.native;
 const size=16384,address=mapExecutableMemory(size);if(address<=0)return 3;
 if(writeExecutableMemory(address,size,0,native.code)!==0)return 4;
 const functions:JitCodeFunction[]=[];
 for(const fn of native.functions){if(fn===undefined)return 5;if(fn.import!==true){const suffix=fn.name.lastIndexOf("$");functions.push({name:"jit:"+(suffix<0?fn.name:fn.name.slice(0,suffix)),offset:fn.offset,byteLength:fn.byteLength});};}
 const lines:JitCodeLine[]=[];
 for(const range of native.sourceRanges){if(range===undefined)return 5;const position=view.positionAt(range.start);if(position.ok)lines.push({offset:range.offset,byteLength:range.byteLength,file:"jit-source.ts",line:position.value.line,column:position.value.column});}
 const registrar=createJitDebugRegistrar({
  debugger:{map:(n:number):number=>mapMemory(n),write:(a:number,l:number,o:number,b:Uint8Array):number=>writeMemoryBytes(a,l,o,b),readWord:(a:number,l:number,o:number):number=>readMemoryWord(a,l,o),writeWord:(a:number,l:number,o:number,v:number):number=>writeMemoryWord(a,l,o,v),descriptor:():number=>jitDebugDescriptor(),notify:():void=>notifyJitDebugger()},
  perfMap:{processId:():number=>processId(),create:(p:string):number=>openExclusive(path(p),420),remove:(p:string):number=>unlink(path(p)),write:(fd:number,b:Uint8Array):number=>write(fd,b)},
 });
 const entry=registrar.register({address,code:native.code,functions,lines,directory:"/"});if(entry<=0)return 6;
 const descriptor=jitDebugDescriptor();
 if(readMemoryWord(descriptor,24,16)!==entry||readMemoryWord(descriptor,24,0)!==1)return 7;
 if(callExecutableNumber(address+compiled.value.entry.offset)!==42)return 8;
 if(!registrar.unregister(entry))return 9;
 if(readMemoryWord(descriptor,24,16)!==0)return 10;
 return 42;
}`;
const snapshot = workspaceSources(),
  bytes = new TextEncoder().encode(text),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules(
    [
      ...projectRoots(),
      memory,
      diagnostics,
      fs,
      compiler,
      sourceText,
      syntax,
      jitDebug,
    ],
    snapshot,
  ),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([
      ["memory", memory],
      ["diagnostics", diagnostics],
      ["fs", fs],
      ["source-text", sourceText],
      ["syntax", syntax],
      ["compiler", compiler],
      ["jit-debug", jitDebug],
    ]),
    sourcePosition: (offset: number) => {
      const position = source.value.positionAt(offset);
      return position.ok ? position.value : undefined;
    },
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
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
  { module: memory, name: "writeMemoryWord", operation: "memory-write-word" },
  {
    module: diagnostics,
    name: "writeMemoryBytes",
    operation: "memory-write-bytes",
  },
  {
    module: diagnostics,
    name: "jitDebugDescriptor",
    operation: "jit-debug-descriptor",
  },
  {
    module: diagnostics,
    name: "notifyJitDebugger",
    operation: "jit-debug-register",
  },
  { module: diagnostics, name: "processId", operation: "process-id" },
];
const built = buildMacOSProgram({
  ...request,
  allowDebugger: true,
  debugSymbols: true,
  allowJit: true,
  jitDebugInterface: true,
  // Raw code capabilities do not yet have the generational write proof.
  runtimeEntry: "initializeCopyingRuntime",
  denseReferenceLists: false,
  entry: "fixture",
  start: "run",
  managedBytes: 67108864,
  allocationCapacity: 1048576,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-hosted-jit-debug",
  runtimes: [
    ...request.runtimes,
    { module: memory, namespace: "native-memory" },
    { module: diagnostics, namespace: "native-diagnostics" },
  ],
  hostBindings: [...request.hostBindings, ...grants],
});
if (!built.ok) assert.fail(JSON.stringify(built.error));
mkdirSync(output);
const path = resolve(output, "jit-debug");
writeFileSync(path, built.value, { flag: "wx", mode: 0o755 });
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      kind: "native-jit-debug-fixture",
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      path,
      expectedExitStatus: 42,
      source: text,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(path);
if (process.env.TINT_BUILD_ONLY === "1") process.exit(0);
const session = spawnSync(
  "lldb",
  [
    "--no-lldbinit",
    "--batch",
    "-o",
    "settings set plugin.jit-loader.gdb.enable on",
    "-o",
    "breakpoint set --name jit:jitSum",
    "-o",
    "breakpoint set --file jit-source.ts --line 3",
    "-o",
    "process launch --stop-at-entry",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateStopped",
    "-o",
    "continue",
    "-o",
    "script assert lldb.process.GetSelectedThread().GetStopReason() == lldb.eStopReasonBreakpoint",
    "-o",
    "script print('jit-pid', lldb.process.GetProcessID())",
    "-o",
    "thread backtrace -c 6",
    "-o",
    "continue",
    "-o",
    "script assert lldb.process.GetSelectedThread().GetStopReason() == lldb.eStopReasonBreakpoint",
    "-o",
    "image lookup -v -a $pc",
    "-o",
    "breakpoint delete 2",
    "-o",
    "continue",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
    path,
  ],
  { encoding: "utf8", timeout: 120000 },
);
writeFileSync(resolve(output, "lldb.txt"), session.stdout + session.stderr);
assert.equal(session.status, 0, session.stdout + session.stderr);
assert.match(session.stdout, /stop reason = breakpoint 1\.1/);
assert.match(
  session.stdout,
  /frame #0: 0x[0-9a-f]+ JIT\(0x[0-9a-f]+\)`jit:jitSum/,
);
assert.match(session.stdout, /program:fixture:run/);
assert.match(session.stdout, /stop reason = breakpoint 2\.1/);
assert.match(
  session.stdout,
  /LineEntry: \[0x[0-9a-f]+-0x[0-9a-f]+\): \/jit-source\.ts:3:/,
);
assert.match(session.stdout, /exited with status = 42/);
const pid = /jit-pid (\d+)/.exec(session.stdout)?.[1];
assert.ok(pid !== undefined, "LLDB did not report the process ID");
const perfMap = "/tmp/perf-" + pid + ".map";
assert.ok(existsSync(perfMap), perfMap);
const map = readFileSync(perfMap, "utf8");
writeFileSync(resolve(output, "perf.map"), map);
rmSync(perfMap);
assert.match(map, /^[0-9a-f]+ [0-9a-f]+ jit:jitSum\n/m);
console.log(
  "Verified JIT debugger registration, LLDB breakpoint/backtrace/line and perf map.",
);
