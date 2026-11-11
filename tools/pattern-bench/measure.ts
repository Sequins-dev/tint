// Measures instructions and cycles per operation for each pattern under tint
// (native) and Node, each minus its own empty-program baseline:
//   node tools/pattern-bench/measure.ts [pattern ...]
// Native binaries are first confirmed under LLDB (exit 42 = checksum equal to
// Node's), then timed directly with /usr/bin/time -l (best of two runs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function counters(
  command: string,
  args: string[],
): {
  instructions: number;
  cycles: number;
  status: number;
} {
  let best = { instructions: Infinity, cycles: Infinity, status: -1 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync("/usr/bin/time", ["-l", command, ...args], {
      encoding: "utf8",
      env: environment,
    });
    const text = result.stderr;
    const instructions = Number(/(\d+)\s+instructions retired/.exec(text)?.[1]),
      cycles = Number(/(\d+)\s+cycles elapsed/.exec(text)?.[1]);
    if (cycles < best.cycles)
      best = { instructions, cycles, status: result.status ?? -1 };
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
    "tint ins/op".padStart(12) +
    "node ins/op".padStart(12) +
    "ratio".padStart(8) +
    "tint cyc/op".padStart(12) +
    "node cyc/op".padStart(12) +
    "ratio".padStart(8),
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
