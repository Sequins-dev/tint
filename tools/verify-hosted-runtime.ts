import { emitDarwinModule } from "./aarch64-executable.ts";
import { buildAArch64Executable } from "./aarch64-executable.ts";
import { darwinAArch64Target } from "@tint/platform/target";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  planScalarClosures,
  lowerClosureFactory,
} from "@tint/ts-native/closure/lowering";

import { compileArm64Program } from "@tint/compiler/native";
import { emitHostedEntry } from "@tint/codegen/aarch64/startup";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const checked = checkClosureModule(
  parse(
    readFileSync(
      "packages/native-runtime/src/allocators/region/index.ts",
      "utf8",
    ),
  ),
);
assert.ok(checked.ok);
const planned = planScalarClosures(
  checked.value,
  {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  },
  4096,
);
assert.ok(planned.ok);
const environment = planned.value.environments[0]!;
const lowered = lowerClosureFactory(checked.value, 0, environment);
assert.ok(lowered.ok, JSON.stringify(lowered));
const allocator = emitDarwinModule(lowered.value.module);
assert.ok(allocator.ok);
const allocate = lowered.value.exports.find(
  (item) => item.name === "allocate",
)!.function;
const entry = "packages/native-runtime/src/index.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
const runtime = compileArm64Program({
  modules: workspaceModules([entry]).map((module) =>
    module.id !== entry
      ? module
      : {
          ...module,
          // Verify the actual startup headers delivered to native runtime code. Page
          // indexing must remain available when every allocation descriptor is used.
          module: parse(
            readFileSync(entry, "utf8").replace(
              "  const workBudget =",
              '  if(starts.length < sizes.length + Math.ceil(managedLength/4096) + 1)throw "MISSING_PAGE_WORKSPACE";\n  const workBudget =',
            ),
          ),
        },
  ),
  entry,
  exports: ["initializeRuntime"],
  start: "initializeRuntime",
  runtimes: [{ module: memory, namespace: "native-memory" }],
  hostBindings: [
    { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
    { module: memory, name: "currentRootHead", operation: "root-head" },
  ],
});
assert.ok(runtime.ok, JSON.stringify(runtime));
assert.notEqual(runtime.value.entry, undefined);
const program = compileArm64Program({
  modules: [
    {
      id: "process",
      dependencies: new Map(),
      module: parse(
        readFileSync(
          "packages/native-runtime/src/intrinsics/process.ts",
          "utf8",
        ),
      ),
    },
    {
      id: "main",
      dependencies: new Map([["native-process", "process"]]),
      module: parse(
        `import {argumentCount,argumentByteLength,copyArgument} from "native-process";
        interface Input {readonly data?:Uint8Array|undefined}
        function select(input:Input):Uint8Array{return input.data??new Uint8Array(0);}
        export function run():number{
        // Each allocation exceeds half the heap. Crossing a block boundary must
        // release the preceding unreferenced temporary before the next allocation.
        if(argumentCount()===3){new Uint8Array(3000);}
        if(argumentCount()===3){new Uint8Array(3000);}
        if(argumentCount()===3){new Uint8Array(3000);}
        const usedOnce=new Uint8Array(3000);
        if(usedOnce.length!==3000)return -8;
        if(argumentCount()===3){new Uint8Array(3000);}
        try {throw "retained"+"!";}
        catch(error){
          if(argumentCount()===3){new Uint8Array(3000);}
          if(error!=="retained!")return -7;
        }
        if(select({}).length!==0||select({data:undefined}).length!==0)return -5;
        if(argumentCount()!==3||argumentByteLength(1)!==3||argumentByteLength(2)!==2||argumentByteLength(3)!==-1)return -2;
        const bytes=new Uint8Array(4),small=new Uint8Array(1);
        if(copyArgument(1,bytes)!==3||bytes[0]!==97||bytes[1]!==98||bytes[2]!==99)return -3;
        if(copyArgument(2,bytes)!==2||bytes[0]!==195||bytes[1]!==169||copyArgument(2,small)!==-1)return -4;
        const input:Input={data:bytes};
        let value:{value:number}|undefined=undefined;for(let index=0;index<${Number(process.env.TINT_HOST_ALLOCATIONS ?? 5000)};index++){value={value:index};}if(value===undefined)return -1;if(select(input)[0]!==195)return -6;return value.value-(${Number(process.env.TINT_HOST_ALLOCATIONS ?? 5000) - 43});}`,
      ),
    },
  ],
  entry: "main",
  exports: ["run"],
  start: "run",
  runtimes: [{ module: "process", namespace: "native-process" }],
  hostBindings: [
    { module: "process", name: "argumentCount", operation: "argument-count" },
    {
      module: "process",
      name: "argumentByteLength",
      operation: "argument-length",
    },
    { module: "process", name: "copyArgument", operation: "argument-copy" },
  ],
});
assert.ok(program.ok, JSON.stringify(program));
assert.notEqual(program.value.entry, undefined);
const hosted = emitHostedEntry({
  abi: darwinAArch64Target.hostABI,
  allocator: {
    native: allocator.value,
    initialize: lowered.value.initializer,
    allocate,
    environmentBytes: environment.layout.size,
  },
  runtime: { native: runtime.value.native, entry: runtime.value.entry! },
  program: { native: program.value.native, entry: program.value.entry! },
  managedBytes: 4096,
  controlBytes: 16384,
  allocationCapacity: 128,
  rootCapacity: 256,
  stackBytes: 1048576,
  pageSize: darwinAArch64Target.memoryPageBytes,
});
assert.ok(hosted.ok, JSON.stringify(hosted));
const image = buildAArch64Executable({
  code: hosted.value.code,
  entryOffset: hosted.value.entryOffset,
  identifier: "tint-hosted-runtime",
  minimumOS: darwinAArch64Target.minimumOS,
  sdk: darwinAArch64Target.sdk,
  maxByteLength: 0xffffffff,
  imports: [...new Set(hosted.value.imports.map((item) => item.target.name))],
  addressFixups: hosted.value.imports,
});
assert.ok(image.ok, JSON.stringify(image));
const directory = mkdtempSync(join(tmpdir(), "tint-hosted-runtime-")),
  path = join(directory, "hosted");
writeFileSync(path, image.value.bytes, { mode: 0o755 });
writeFileSync(
  path + ".json",
  JSON.stringify(
    [allocator.value, runtime.value.native, program.value.native].flatMap(
      (module, index) => {
        const base =
          Buffer.from(hosted.value.code).indexOf(module.code) +
          image.value.codeFileOffset +
          0x100000000;
        return module.functions.map((fn) => ({
          module: index,
          name: fn.name,
          address: "0x" + (base + fn.offset).toString(16),
          bytes: fn.byteLength,
        }));
      },
    ),
    null,
    2,
  ),
);
console.log(path);
if (process.env.TINT_BUILD_ONLY !== "1") {
  try {
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(path, ["abc", "é"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(run.signal, null, run.stderr);
      assert.equal(run.status, 42, run.stderr);
    }
    console.log(
      "Verified hosted native runtime, automatic collection, guarded stack, and region cleanup twice.",
    );
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(directory, { recursive: true, force: true });
  }
}
