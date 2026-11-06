import { deserialize } from "node:v8";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { emitModule } from "./codegen-post-C2-toolchain-v7/packages/codegen/dist/aarch64/scalar/index.js";
import { compactSlots } from "./codegen-post-C2-toolchain-v7/packages/ir/dist/optimization/slots.js";
import { darwinHostABI } from "./codegen-post-C2-toolchain-v7/packages/platform/dist/darwin/host-abi.js";
import { startNativeHeartbeat } from "../../tools/test262-native-heartbeat.ts";
const directory = ".tint-bootstrap/perf/measure-compiler-frame-compaction-v1";
mkdirSync(directory);
const heartbeat = startNativeHeartbeat(
  "P real compiler emitted frame comparison",
);
try {
  const bytes = readFileSync(
      ".tint-bootstrap/perf/replay-selfbuild-optimized-module-v1.v8",
    ),
    module = deserialize(bytes);
  const [original, , roots] = deserialize(
    readFileSync(
      ".tint-bootstrap/perf/capture-selfbuild-list-ir-v1/input-ir.v8",
    ),
  );
  const entry = module.functions.findIndex(
    (fn) => fn.name === original.functions[roots[1]].name,
  );
  if (entry < 0) throw Error("entry missing");
  const compacted = {
    ...module,
    functions: module.functions.map((fn) => {
      const r = compactSlots(fn, 1000000);
      if (!r) throw Error("frame compaction declined " + fn.id);
      return r.fn;
    }),
  };
  const summary = [];
  for (const [label, input] of [
    ["before", module],
    ["after", compacted],
  ]) {
    heartbeat.phase(label + " emission from same verified compiler IR");
    const started = performance.now(),
      cpu = process.cpuUsage(),
      r = emitModule(input, {
        hostABI: darwinHostABI(),
        maxByteLength: 0xffffffff,
        linearAllocation: true,
        generationalBarriers: true,
        closedRoots: [entry],
      });
    if (!r.ok) throw Error(JSON.stringify(r));
    const native = r.value,
      rootMap = new Map(native.roots.map((root) => [root.function, root]));
    const functions = native.functions.map((fn) => ({
      id: fn.id,
      name: fn.name,
      frameBytes: fn.frameBytes,
      codeBytes: fn.byteLength,
      referenceRoots: rootMap.get(fn.id)?.offsets.length ?? 0,
      generalRoots: rootMap.get(fn.id)?.generalOffsets.length ?? 0,
    }));
    const result = {
      label,
      sourceIRsha256: createHash("sha256").update(bytes).digest("hex"),
      scope:
        "Static output from identical compiler IR, with only unused local slots removed using the existing verified slot compactor; not a native execution speed measurement.",
      emitCPU: process.cpuUsage(cpu),
      emitWallMs: performance.now() - started,
      codeBytes: native.code.length,
      rootFrames: native.roots.length,
      referenceRoots: native.roots.reduce((n, r) => n + r.offsets.length, 0),
      generalRoots: native.roots.reduce(
        (n, r) => n + r.generalOffsets.length,
        0,
      ),
      functions,
    };
    writeFileSync(
      directory + "/" + label + ".json",
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    writeFileSync(directory + "/" + label + ".code", native.code, {
      flag: "wx",
    });
    summary.push({ ...result, functions: undefined });
  }
  writeFileSync(
    directory + "/result.json",
    JSON.stringify(summary, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(summary));
} finally {
  heartbeat.close();
}
