// Measures instructions and cycles per operation for each pattern under tint
// (native) and Node, each minus its own empty-program baseline:
//   node tools/pattern-bench/measure.ts [pattern ...]
// Native binaries are first confirmed under LLDB (exit 42 = checksum equal to
// Node's), then measured directly (best of two runs): /usr/bin/time -l on
// macOS, perf stat on Linux. Hosts without hardware counters (Linux VMs)
// report wall nanoseconds per operation instead.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hardwareCounters, measureProcess } from "../host-tools.ts";

/** Iterations and operations per iteration (the inner loop length). */
const plan: Record<string, { iterations: number; per: number }> = {
  typedSum: { iterations: 20000, per: 1024 },
  arrayPushRead: { iterations: 5000, per: 1024 },
  recordAllocate: { iterations: 3000, per: 1024 },
  temporaryRecord: { iterations: 20000000, per: 1 },
  spreadCopy: { iterations: 5000000, per: 1 },
  closureCalls: { iterations: 20000000, per: 1 },
  mapNumbers: { iterations: 20000, per: 256 },
  mapStrings: { iterations: 20000, per: 256 },
  switchKind: { iterations: 10000, per: 1024 },
  stringScan: { iterations: 20000, per: 1024 },
  directCalls: { iterations: 20000000, per: 1 },
  modulo: { iterations: 20000000, per: 1 },
  sha256: { iterations: 200000, per: 64 },
  mapProject: { iterations: 20000, per: 256 },
  predicates: { iterations: 20000, per: 256 },
  filterMap: { iterations: 20000, per: 256 },
};
const here = fileURLToPath(new URL(".", import.meta.url));
const environment = { ...process.env, TZ: "UTC" };

const counted = hardwareCounters();
/** Best of two runs, by cycles (or by wall time without counters). */
function counters(
  command: string,
  args: string[],
): {
  instructions: number;
  cycles: number;
  seconds: number;
  status: number;
} {
  let best = {
    instructions: Infinity,
    cycles: Infinity,
    seconds: Infinity,
    status: -1,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = measureProcess(command, args, { env: environment });
    const instructions = run.instructions ?? Number.NaN,
      cycles = run.cycles ?? Number.NaN,
      seconds = run.wallSeconds;
    if (counted ? cycles < best.cycles : seconds < best.seconds)
      best = { instructions, cycles, seconds, status: run.status ?? -1 };
  }
  return best;
}
function build(name: string, iterations: number): string {
  const result = spawnSync(
    process.execPath,
    [here + "build-native.ts", name, String(iterations)],
    { encoding: "utf8", env: { ...environment, TINT_BUILD_ONLY: "1" } },
  );
  const path = result.stdout.split("\n").find((line) => line.startsWith("/"));
  if (result.status !== 0 || path === undefined)
    throw Error(
      "build failed for " + name + ":\n" + result.stderr.slice(-2000),
    );
  return path;
}
function confirm(path: string): void {
  const result = spawnSync(
    "lldb",
    ["--batch", "-o", "run", "-k", "bt", "--", path],
    { encoding: "utf8", env: environment },
  );
  if (!/exited with status = 42 /.test(result.stdout))
    throw Error(
      "native checksum or launch failed for " +
        path +
        ":\n" +
        result.stdout.slice(-2000),
    );
}

const selected =
  process.argv.length > 2 ? process.argv.slice(2) : Object.keys(plan);
const nativeBase = counters(build("none", 0), []),
  nodeBase = counters(process.execPath, [here + "node-run.ts", "none", "0"]);
console.log(
  "pattern".padEnd(16) +
    (counted
      ? "tint ins/op".padStart(12) +
        "node ins/op".padStart(12) +
        "ratio".padStart(8) +
        "tint cyc/op".padStart(12) +
        "node cyc/op".padStart(12) +
        "ratio".padStart(8)
      : "tint ns/op".padStart(12) +
        "node ns/op".padStart(12) +
        "ratio".padStart(8) +
        "  (hardware counters unavailable)"),
);
for (const name of selected) {
  const entry = plan[name];
  if (entry === undefined) throw Error("unknown pattern " + name);
  const operations = entry.iterations * entry.per,
    path = build(name, entry.iterations);
  confirm(path);
  const native = counters(path, []),
    node = counters(process.execPath, [
      here + "node-run.ts",
      name,
      String(entry.iterations),
    ]);
  if (native.status !== 42) throw Error("native run failed for " + name);
  if (!counted) {
    const nt = ((native.seconds - nativeBase.seconds) * 1e9) / operations,
      vt = ((node.seconds - nodeBase.seconds) * 1e9) / operations;
    console.log(
      name.padEnd(16) +
        nt.toFixed(2).padStart(12) +
        vt.toFixed(2).padStart(12) +
        (nt / vt).toFixed(1).padStart(8),
    );
    continue;
  }
  const ni = (native.instructions - nativeBase.instructions) / operations,
    vi = (node.instructions - nodeBase.instructions) / operations,
    nc = (native.cycles - nativeBase.cycles) / operations,
    vc = (node.cycles - nodeBase.cycles) / operations;
  console.log(
    name.padEnd(16) +
      ni.toFixed(1).padStart(12) +
      vi.toFixed(1).padStart(12) +
      (ni / vi).toFixed(1).padStart(8) +
      nc.toFixed(1).padStart(12) +
      vc.toFixed(1).padStart(12) +
      (nc / vc).toFixed(1).padStart(8),
  );
}
