import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";
import { nativeStackMapMagic, nativeStackMapWideVersion } from "@tint/abi/host";
import { nativeFixtureTarget } from "./native-host-target.ts";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
const parallelThreads = process.env.TINT_PARALLEL_THREADS === "1";
const parallel = parallelThreads || process.env.TINT_PARALLEL_RUNTIME === "1";
const parallelRejection = process.env.TINT_REJECT_PARALLEL;
const rejectParallel =
  parallel && (parallelRejection === "1" || parallelRejection === "major");
const generational = parallel || process.env.TINT_GENERATIONAL_RUNTIME === "1";
const disableBarriers = process.env.TINT_DISABLE_BARRIERS === "1";
const overflowQueue = process.env.TINT_REMEMBERED_OVERFLOW === "1";
const rejectMajor = process.env.TINT_REJECT_MAJOR === "1";
const rejectMinor = process.env.TINT_REJECT_MINOR === "1";
const rejectAllocations = process.env.TINT_REJECT_ALLOCATIONS === "1";
const receivers = process.env.TINT_RECEIVER_RUNTIME === "1";
const generalArrays = process.env.TINT_GENERAL_ARRAY_RUNTIME === "1";
const stringPressure = process.env.TINT_STRING_RUNTIME === "1";
const forcedCollection = process.env.TINT_FORCED_COLLECTION === "1";
const shiftedPC = process.env.TINT_SHIFT_SAFEPOINT_PC === "1";
const memoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
const parallelFixture = `import { collectGarbage } from "memory";
interface Link { next: Link | undefined; value: number; }
function fill(first: Link, last: Link): number {
  for (let i = 0; i < 192; i++) {
    const garbage = new Uint8Array(65536);
    garbage[0] = i;
    if (garbage[0] !== i || first.next !== last || last.next !== first) return 1;
  }
  return first.value + last.value;
}
function runParallel(): number {
  const first: Link = { next: undefined, value: 19 };
  const last: Link = { next: first, value: 23 };
  first.next = last;
  const backing = new Uint32Array(16);
  const view = backing.subarray(4, 8);
  view[1] = 42;
  if (fill(first, last) !== 42) return 2;
  collectGarbage();
  if (first.next !== last || last.next !== first) return 3;
  return backing[5] === 42 && view[1] === 42 ? 42 : 4;
}`;
const fixture = parallel
  ? parallelFixture +
    (parallelThreads
      ? `
import { startNativeThread, joinNativeThread, hostedThreadEntry, openRuntimeFile,
  readRuntimeFile, closeRuntimeFile } from "memory";
function threadCount(): number {
  const path = "/proc/self/status";
  const key = "Threads:\\t";
  const name = new Uint8Array(path.length + 1);
  for (let i = 0; i < path.length; i++) name[i] = path.charCodeAt(i);
  const fd = openRuntimeFile(name);
  if (fd < 0) return -1;
  const data = new Uint8Array(4096);
  const length = readRuntimeFile(fd, data);
  closeRuntimeFile(fd);
  for (let i = 1; i + key.length < length; i++) {
    if (data[i - 1] !== 10) continue;
    let j = 0;
    while (j < key.length && data[i + j] === key.charCodeAt(j)) j++;
    if (j < key.length) continue;
    let total = 0;
    for (let at = i + j; at < length; at++) {
      const digit = (data[at] ?? 0) - 48;
      if (digit < 0 || digit > 9) break;
      total = total * 10 + digit;
    }
    return total;
  }
  return -1;
}
export function run(argument: number): number {
  if (argument !== 0) return runParallel();
  const before = threadCount();
  if (before <= 0) return 5;
  const handle = startNativeThread(hostedThreadEntry(), 42);
  if (handle <= 0 || joinNativeThread(handle) !== 42) return 6;
  for (let i = 0; i < 100; i++)
    if (threadCount() === before) return 42;
  return 7;
}`
      : "\nexport function run(): number { return runParallel(); }")
  : forcedCollection
    ? `import { collectGarbage } from "memory";
interface Record { value: number; }
function throwRecord(): void {
  const record: Record = { value: 42 };
  throw record;
}
function relocateThrown(): void {
  try { throwRecord(); }
  catch (caught) {
    collectGarbage();
    throw caught;
  }
}
export function run(): number {
  // Dead old storage gives the thrown record room to move in the major.
  const old = new Uint8Array(144);
  if (old.length !== 144) return 2;
  try { relocateThrown(); }
  catch (caught) { return (caught as Record).value; }
  return 3;
}`
    : rejectAllocations
      ? `interface Small { value: number; }
    export function run(): number {
      const a: Small = { value: 42 };
      const b = new Uint8Array(16);
      b[0] = a.value;
      return b[0] ?? 0;
    }`
      : generalArrays
        ? `function create():unknown[]{
 const object={value:42};return [object,object,"persistent"+String(42),undefined,false,42];
}
export function run():number {
 const values=create();
 for(let i=0;i<200;i++){
  const fresh={value:i};values[6]=fresh;values[7]=fresh;
  for(let j=0;j<20;j++){const garbage=new Uint32Array(50);garbage[0]=j;if(garbage[0]!==j)return 1;}
  if(typeof values[0]!=="object"||values[0]!==values[1]||values[2]!=="persistent42")return 2;
  if(values[3]!==undefined||values[4]!==false||values[5]!==42)return 3;
  if(values[6]!==fresh||values[7]!==fresh)return 4;
 }
 return 42;
}`
        : receivers
          ? `interface Value {value:number;}
interface Owner {value:number;read(this:Value):number;capture(this:Value):()=>number;}
function create():Owner {
 return {value:42,
  read:function(this:Value):number {
   for(let i=0;i<40;i++){const garbage=new Uint32Array(50);garbage[0]=i;if(garbage[0]!==i)return 1;}
   return this.value;
  },
  capture:function(this:Value):()=>number{return ():number=>this.value;}
 };
}
export function run():number {
 const captured=create().capture();
 for(let i=0;i<40;i++){if(create().read()!==42||captured()!==42)return 2;}
 return 42;
}`
          : generational && !stringPressure
            ? `interface Link {next:Link|undefined;value:number;}
export function run():number {
 const a:Link={next:undefined,value:1},b:Link={next:undefined,value:2},c:Link={next:undefined,value:3};
 let held:Link={next:undefined,value:0};const get=():number=>held.value;
 const array=new Uint32Array(8);array[3]=42;const view=array.subarray(2,6),nested=view.subarray(1,2);
 for(let i=0;i<200;i++) {
  a.next={next:undefined,value:i};b.next={next:a,value:i+1};c.next={next:b,value:i+2};held={next:c,value:i+3};
  for(let j=0;j<20;j++){const garbage=new Uint32Array(50);garbage[0]=j;if(garbage[0]!==j)return 3;}
  const an=a.next,bn=b.next,cn=c.next;
  if(an===undefined||bn===undefined||cn===undefined)return 4;
  if(an.value!==i||bn.value!==i+1||cn.value!==i+2||get()!==i+3)return 4;
  if(bn.next!==a||cn.next!==b||held.next!==c||nested[0]!==42||view[1]!==42)return 5;
 }
 return 42;
}`
            : `interface Link {next:Link|undefined;value:number;}
export function run():number {
 const first:Link={next:undefined,value:19},second:Link={next:first,value:23};first.next=second;
 const links:Link[]=[];for(let i=0;i<16;i++)links.push(i%2===0?first:second);
 const array=new Uint32Array(8);array[3]=42;const view=array.subarray(2,6),nested=view.subarray(1,2);
 let text="seed";
 const get=():number=>first.value+second.value;
 for(let i=0;i<200;i++) {
  const garbage:Link={next:undefined,value:i};
  text=(text+"x").slice(0,8);
  const live:Link={next:first,value:garbage.value};
  const kept=links[i%16];if(kept!==(i%2===0?first:second))return 2;
  if(live.next!==first||first.next!==second||second.next!==first||get()!==42||nested[0]!==42||view[1]!==42||array[3]!==42||text.length<4)return 1;
 }
 return 42;
}`;
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const modules = [...workspaceModules(projectRoots())];
const runtime = modules.find(
  (item) => item.id === "packages/native-runtime/src/index.ts",
);
assert.ok(runtime);
let runtimeSource = readFileSync("packages/native-runtime/src/index.ts", "utf8")
  .replace(
    "readMemoryWord, currentRootHead",
    "readMemoryWord, currentRootHead, writeMemoryWord, moveMemory",
  )
  .replace(
    "    base: managedBase,",
    `    compaction: {
      offsets:new Uint32Array(256),live:new Uint8Array(256),pinned:new Uint8Array(256),destinations:new Uint32Array(256),summary:new Uint32Array(4),slots:new Float64Array(4096),values:new Float64Array(4096),publishedOffsets:new Uint32Array(256),publishedSizes:new Uint32Array(256),
      canWrite:(slot:number):boolean=>contains(managedBase,managedLength,slot)||contains(stackBase,stackLength,slot),
      write:(slot:number,value:number):boolean=>contains(managedBase,managedLength,slot)?writeMemoryWord(managedBase,managedLength,slot-managedBase,value)===0:writeMemoryWord(stackBase,stackLength,slot-stackBase,value)===0,
      move:(destination:number,source:number,size:number):boolean=>moveMemory(managedBase,managedLength,destination,source,size)===0
    },
    base: managedBase,`,
  );
// A negative control proves the fixture actually reaches a nontrivial move.
const rejectMoves = process.env.TINT_REJECT_MOVES === "1";
if (rejectMoves)
  runtimeSource = runtimeSource.replace(
    "moveMemory(managedBase,managedLength,destination,source,size)===0",
    "false",
  );
const index = modules.indexOf(runtime);
if (!generational)
  modules[index] = { ...runtime, module: parse(runtimeSource) };
else if (
  rejectMoves ||
  rejectAllocations ||
  overflowQueue ||
  rejectMajor ||
  rejectMinor ||
  disableBarriers
) {
  const runtimePath = "packages/native-runtime/src/generational.ts";
  const generationalIndex = modules.findIndex(
    (item) => item.id === runtimePath,
  );
  const generationalModule = modules[generationalIndex];
  assert.ok(generationalModule);
  const text = readFileSync(runtimePath, "utf8");
  let modified = text;
  if (rejectMoves) {
    const id = "packages/native-runtime/src/tracing/cheney.ts";
    const index = modules.findIndex((item) => item.id === id);
    const cheney = modules[index];
    assert.ok(cheney);
    const text = readFileSync(id, "utf8");
    const reject = text.replace(/moveMemory\([\s\S]*?\) !== 0/g, "true");
    assert.notEqual(reject, text);
    modules[index] = { ...cheney, module: parse(reject) };
  }
  if (rejectAllocations)
    modified = modified.replace(
      "return (bytes) => {",
      'return (bytes) => { if (bytes >= 0) throw "INLINE_SLOW_PATH_USED";',
    );
  if (overflowQueue)
    modified = modified.replace(
      "  const capacity =",
      "  roots = roots.subarray(0, 1);\n  const capacity =",
    );
  if (rejectMajor)
    modified = modified.replace(
      "    collecting = true;",
      '    if (!minor) throw "MAJOR_REACHED";\n    collecting = true;',
    );
  if (rejectMinor)
    modified = modified.replace(
      "    collecting = true;",
      '    if (minor) throw "MINOR_REACHED";\n    collecting = true;',
    );
  if (disableBarriers)
    modified = modified.replace(
      "  function collect(",
      "  allocation[6] = 0;\n  function collect(",
    );
  if (modified !== text)
    modules[generationalIndex] = {
      ...generationalModule,
      module: parse(modified),
    };
  else assert.ok(rejectMoves);
}
modules.push({
  id: "fixture",
  module: parse(fixture),
  dependencies: new Map(
    forcedCollection || parallel ? [["memory", memoryModule]] : [],
  ),
});
if (rejectParallel) {
  const id = "packages/native-runtime/src/tracing/parallel.ts";
  const index = modules.findIndex((item) => item.id === id);
  const source = modules[index];
  assert.ok(source);
  const text = readFileSync(id, "utf8");
  const needle =
    parallelRejection === "major"
      ? "      runCommand(commandMark, 0, rootHead);"
      : "      runCommand(commandEvacuate, first, rootHead);";
  const modified = text.replace(
    needle,
    needle + '\n      if (tracedTotal() >= 0) throw "PARALLEL_PHASE_REACHED";',
  );
  assert.notEqual(modified, text);
  modules[index] = { ...source, module: parse(modified) };
}
const target = nativeFixtureTarget();
const request = projectBuildRequest(modules, () => {});
const built = buildMacOSProgram({
  target,
  ...request,
  runtimes:
    forcedCollection || parallel
      ? [
          ...request.runtimes,
          { module: memoryModule, namespace: "native-memory" },
        ]
      : request.runtimes,
  hostBindings:
    forcedCollection || parallel
      ? [
          ...request.hostBindings,
          {
            module: memoryModule,
            name: "collectGarbage",
            operation: "collect-garbage",
          },
          ...(parallelThreads
            ? ([
                {
                  module: memoryModule,
                  name: "startNativeThread",
                  operation: "thread-start",
                },
                {
                  module: memoryModule,
                  name: "joinNativeThread",
                  operation: "thread-join",
                },
                {
                  module: memoryModule,
                  name: "hostedThreadEntry",
                  operation: "hosted-thread-entry",
                },
                {
                  module: memoryModule,
                  name: "openRuntimeFile",
                  operation: "open-read",
                },
                {
                  module: memoryModule,
                  name: "readRuntimeFile",
                  operation: "read",
                },
                {
                  module: memoryModule,
                  name: "closeRuntimeFile",
                  operation: "close",
                },
              ] as const)
            : []),
        ]
      : request.hostBindings,
  runtimeEntry: generational
    ? "initializeGenerationalRuntime"
    : "initializeRuntime",
  inlineAllocation: generational && process.env.TINT_INLINE_ALLOCATION !== "0",
  ...(process.env.TINT_SIGNPOSTS === "1" ? { signposts: true } : {}),
  ...(parallel ? { requireParallelCollection: true } : {}),
  ...(parallelThreads ? { threaded: true } : {}),
  entry: "fixture",
  start: "run",
  managedBytes: parallel ? 67108864 : 8192,
  controlBytes: parallel ? 1048576 : 262144,
  allocationCapacity: parallel ? 1048576 : 256,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-moving-runtime",
});
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-moving-runtime-")),
  path = join(directory, "runtime");
if (shiftedPC) {
  const image = Buffer.from(
    built.value.buffer,
    built.value.byteOffset,
    built.value.byteLength,
  );
  const tag = Buffer.alloc(16);
  tag.writeBigUInt64LE(BigInt(nativeStackMapMagic), 0);
  tag.writeBigUInt64LE(BigInt(nativeStackMapWideVersion), 8);
  const table = image.indexOf(tag);
  assert.ok(table >= 0);
  const count = Number(image.readBigUInt64LE(table + 16));
  assert.ok(count > 0);
  for (let i = 0; i < count; i++) {
    const offset = table + 24 + i * 16;
    image.writeBigUInt64LE(image.readBigUInt64LE(offset) + 1n, offset);
  }
}
writeFileSync(path, built.value, { mode: 0o755 });
console.log(path);
if (target.arch === "x86_64" && process.env.TINT_BUILD_ONLY !== "1") {
  const artifact = nativeArtifact(target.name, path);
  const results = runNativeBatch([{ artifact }, { artifact }]);
  for (const result of results) {
    console.log(JSON.stringify(result));
    if (
      disableBarriers &&
      result.kind === "signaled" &&
      result.signal === "SIGILL"
    )
      continue;
    assert.equal(result.kind, "exited");
    const rejected =
      shiftedPC ||
      rejectParallel ||
      rejectMoves ||
      rejectMajor ||
      rejectMinor ||
      (rejectAllocations && process.env.TINT_INLINE_ALLOCATION === "0");
    if (disableBarriers)
      assert.ok(
        result.status === 4 || result.status === 5 || result.status === 1,
      );
    else assert.equal(result.status, rejected ? 1 : 42);
  }
  console.log("Verified moving-runtime fixture twice.");
  process.exit(0);
}
for (
  let attempt = 0;
  process.env.TINT_BUILD_ONLY !== "1" && attempt < 2;
  attempt++
) {
  const result = spawnSync(
    "/usr/bin/lldb",
    ["--batch", "-o", "process launch --stop-at-entry", "-o", "continue", path],
    {
      encoding: "utf8",
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  if (disableBarriers) {
    assert.match(
      result.stdout,
      /exited with status = (4|5|70) |stop reason = EXC_BREAKPOINT/,
      result.stdout,
    );
    continue;
  }
  assert.match(
    result.stdout,
    rejectMoves ||
      rejectMajor ||
      rejectMinor ||
      (rejectAllocations && process.env.TINT_INLINE_ALLOCATION === "0")
      ? /exited with status = 70 /
      : /exited with status = 42 /,
  );
}
console.log(
  process.env.TINT_BUILD_ONLY === "1"
    ? "Built moving-runtime fixture for debugger execution; not yet executed."
    : disableBarriers
      ? "Verified missing-barrier failure control twice under LLDB."
      : rejectMajor
        ? "Verified major-collection failure control twice."
        : rejectMinor
          ? "Verified minor-collection failure control twice."
          : overflowQueue
            ? "Verified remembered-queue overflow recovery twice."
            : rejectAllocations
              ? "Verified inline allocation with rejecting slow callback twice."
              : rejectMoves
                ? "Verified relocation failure negative control twice."
                : "Verified generated-code references survive moving collection twice.",
);
