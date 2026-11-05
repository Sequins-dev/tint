import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, cpus, homedir, platform, release } from "node:os";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { workspaceSources } from "./workspace-sources.ts";
import {
  readNodeSamples,
  readNativeSamples,
  compareBenchmarks,
} from "./benchmark-results.ts";
function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--"))
    throw Error(name + " requires a value");
  return value;
}
function run(binary: string, args: string[]) {
  const start = performance.now(),
    result = spawnSync(binary, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  return { ...result, elapsedMs: performance.now() - start };
}
function success(result: ReturnType<typeof run>, label: string) {
  if (result.status !== 0 || result.signal || result.error)
    throw Error(
      label +
        " failed: " +
        (result.error?.message ?? result.signal ?? result.status) +
        "\n" +
        result.stdout +
        result.stderr,
    );
}
function hash(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function benchmarkNode(): { binary: string; version: string } {
  const explicit = process.env.TINT_BENCH_NODE,
    candidates = explicit ? [explicit] : [process.execPath];
  if (!explicit) {
    try {
      const root = join(homedir(), ".nvm/versions/node");
      for (const version of readdirSync(root).sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }),
      ))
        candidates.push(join(root, version, "bin/node"));
    } catch {}
  }
  for (const binary of [...new Set(candidates)]) {
    const probe = run(binary, [
      "--experimental-bench",
      "--input-type=module",
      "-e",
      'import {bench} from "node:bench"; if(typeof bench!=="function")throw Error("missing benchmark API"); console.log(process.version)',
    ]);
    if (probe.status === 0) return { binary, version: probe.stdout.trim() };
  }
  throw Error(
    "Set TINT_BENCH_NODE to a Node.js binary providing experimental node:bench (26.9+).",
  );
}
const node = benchmarkNode(),
  directory = resolve(
    option("--output") ??
      join(".tint-bench/runs", new Date().toISOString().replaceAll(":", "-")),
  );
mkdirSync(dirname(directory), { recursive: true });
mkdirSync(directory);
const nativePath = join(directory, "runtime-native"),
  nodeEntry = join(directory, "node-entry.mjs");
writeFileSync(
  nodeEntry,
  'import {run} from "node:bench";\nimport {registerBenchmarks} from ' +
    JSON.stringify(pathToFileURL(resolve("benchmarks/runtime.bench.ts")).href) +
    ';\nregisterBenchmarks();\nfor await(const record of run({yieldBetweenSamples:false})) process.stdout.write(JSON.stringify(record,(_key,value)=>typeof value==="bigint"?value.toString():value)+"\\n");\n',
);
console.log("Building native benchmark executable...");
const build = run(process.execPath, ["tools/build-benchmarks.ts", nativePath]);
writeFileSync(join(directory, "build.log"), build.stdout + build.stderr);
success(build, "native benchmark build");
console.log("Measuring Node.js " + node.version + "...");
const nodeRun = run(node.binary, ["--experimental-bench", nodeEntry]);
writeFileSync(join(directory, "node.jsonl"), nodeRun.stdout);
writeFileSync(join(directory, "node.stderr"), nodeRun.stderr);
success(nodeRun, "Node benchmark");
console.log("Measuring native output (one process under LLDB)...");
const nativeRun = run("/usr/bin/lldb", [
  "--batch",
  "-o",
  "run",
  "-o",
  "process status",
  nativePath,
]);
writeFileSync(
  join(directory, "native.log"),
  nativeRun.stdout + nativeRun.stderr,
);
success(nativeRun, "native benchmark debugger");
assert.match(
  nativeRun.stdout,
  /exited with status = 0 /,
  "native benchmark did not exit successfully",
);
assert.doesNotMatch(
  nativeRun.stdout,
  /stop reason =/,
  "native benchmark stopped before completion",
);
const cases = compareBenchmarks(
  readNodeSamples(nodeRun.stdout),
  readNativeSamples(nativeRun.stdout),
);
const sources = workspaceSources(),
  sourceHasher = createHash("sha256");
for (const input of sources.inputs)
  sourceHasher.update(input.id).update(input.bytes);
const report = {
  protocol: "tint-node-bench-sync-v1",
  createdAt: new Date().toISOString(),
  workloadHash: hash(readFileSync("benchmarks/runtime.bench.ts")),
  sourceHash: sourceHasher.digest("hex"),
  nativeBinaryHash: hash(readFileSync(nativePath)),
  environment: {
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
    node: node.version,
    nodeBinary: node.binary,
  },
  measurement: {
    nativeClock: "CLOCK_MONOTONIC_RAW milliseconds rounded to nanoseconds",
    nodeClock: "node:bench hrtime.bigint",
    yieldBetweenSamples: false,
    nativeManagedBytes: 33554432,
    nodeHeap: "Node defaults",
    nativeDebugger: "LLDB, no breakpoints",
    sampling:
      "Per-case options in the hashed workload; measured sample counts are included in cases and raw logs",
  },
  elapsedMs: {
    build: build.elapsedMs,
    nodeProcess: nodeRun.elapsedMs,
    nativeProcess: nativeRun.elapsedMs,
  },
  cases,
};
const baselinePath = option("--baseline");
if (baselinePath) {
  const baseline = JSON.parse(
    readFileSync(baselinePath, "utf8"),
  ) as typeof report;
  assert.equal(baseline.protocol, report.protocol, "baseline protocol differs");
  assert.equal(
    baseline.workloadHash,
    report.workloadHash,
    "baseline workload differs",
  );
  for (const key of ["platform", "arch", "cpu", "node"] as const)
    assert.equal(
      baseline.environment[key],
      report.environment[key],
      "baseline environment differs: " + key,
    );
  assert.equal(
    baseline.cases.length,
    cases.length,
    "baseline benchmark set differs",
  );
  for (const item of cases) {
    const prior = baseline.cases.find((value) => value.name === item.name);
    assert.ok(prior, "missing baseline case");
    assert.ok(
      Number.isFinite(prior.native.meanNsPerOperation) &&
        prior.native.meanNsPerOperation > 0,
    );
    console.log(
      item.name +
        ": native/prior " +
        (
          item.native.meanNsPerOperation / prior.native.meanNsPerOperation
        ).toFixed(2) +
        "x" +
        (item.noisy || prior.noisy ? " (noisy; inspect samples)" : ""),
    );
  }
}
writeFileSync(
  join(directory, "results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log("Benchmark | Node ns/op | Native ns/op | Native/Node");
for (const item of cases)
  console.log(
    item.name +
      " | " +
      item.node.meanNsPerOperation.toFixed(1) +
      " | " +
      item.native.meanNsPerOperation.toFixed(1) +
      " | " +
      item.nativeToNode.toFixed(2) +
      "x" +
      (item.noisy ? " (noisy)" : ""),
  );
console.log("Saved " + join(directory, "results.json"));
