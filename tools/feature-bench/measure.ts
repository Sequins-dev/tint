// Feature benchmark: each kernel built natively (checksum confirmed against
// Node under LLDB) and timed against Node (/usr/bin/time -l on macOS; GNU
// time and perf stat on Linux), best of `--rounds` runs, minus each
// engine's empty-program baseline:
//   node tools/feature-bench/measure.ts [kernel ...] [--rounds N]
// Node includes its JIT warm-up, as an AOT binary has none to pay. Hosts
// without hardware counters (Linux VMs) pick the best run by wall time and
// print the cycle and instruction columns as "unavailable".
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hardwareCounters, measureProcess } from "../host-tools.ts";

/** Scales calibrated to roughly one second of Node execution each. */
const scales: Record<string, number> = {
  interpreter: 1600,
  records: 100000,
  closures: 300000,
  pipelines: 33000,
  collections: 19000,
  strings: 43000,
  numeric: 8500,
  recursion: 14000,
  exceptions: 300000,
  optionals: 300000,
  sorting: 5000,
  serialization: 19000,
};
const here = fileURLToPath(new URL(".", import.meta.url));
const environment = { ...process.env, TZ: "UTC" };
const argv = process.argv.slice(2),
  roundsAt = argv.indexOf("--rounds"),
  rounds = roundsAt < 0 ? 2 : Number(argv[roundsAt + 1] ?? "2"),
  selected = argv.filter(
    (arg, i) => !arg.startsWith("--") && (roundsAt < 0 || i !== roundsAt + 1),
  );

interface Sample {
  readonly seconds: number;
  readonly cycles: number;
  readonly instructions: number;
  readonly status: number;
}
function best(command: string, args: string[]): Sample {
  let result: Sample = {
    seconds: Infinity,
    cycles: Infinity,
    instructions: Infinity,
    status: -1,
  };
  for (let round = 0; round < rounds; round++) {
    const run = measureProcess(command, args, { env: environment });
    const seconds = run.wallSeconds,
      cycles = run.cycles ?? Number.NaN,
      instructions = run.instructions ?? Number.NaN;
    if (counted ? cycles < result.cycles : seconds < result.seconds)
      result = { seconds, cycles, instructions, status: run.status ?? -1 };
  }
  return result;
}
const counted = hardwareCounters();
/** A counter column: billions, or "unavailable" without counters. */
function giga(value: number, width: number): string {
  return (counted ? (value / 1e9).toFixed(2) : "unavail.").padStart(width);
}
function build(name: string, scale: number): string {
  const result = spawnSync(
    process.execPath,
    [here + "build-native.ts", name, String(scale)],
    { encoding: "utf8", env: { ...environment, TINT_BUILD_ONLY: "1" } },
  );
  const path = result.stdout.split("\n").find((line) => line.startsWith("/"));
  if (result.status !== 0 || path === undefined)
    throw Error(
      "build failed for " + name + ":\n" + result.stderr.slice(-3000),
    );
  return path;
}
function confirm(path: string): void {
  const result = spawnSync(
    "lldb",
    ["--batch", "-o", "run", "-k", "bt", "--", path],
    {
      encoding: "utf8",
      env: environment,
    },
  );
  if (!/exited with status = 42 /.test(result.stdout))
    throw Error(
      "native checksum failed for " + path + ":\n" + result.stdout.slice(-2000),
    );
}

const nativeBase = best(build("none", 0), []),
  nodeBase = best(process.execPath, [here + "node-run.ts", "none", "0"]);
console.log(
  "kernel".padEnd(15) +
    "tint s".padStart(8) +
    "node s".padStart(8) +
    "ratio".padStart(7) +
    "tint Gcyc".padStart(11) +
    "node Gcyc".padStart(11) +
    "ratio".padStart(7) +
    "tint Gins".padStart(11) +
    "node Gins".padStart(11),
);
let tintTotal = 0,
  nodeTotal = 0;
for (const name of selected.length > 0 ? selected : Object.keys(scales)) {
  const scale = scales[name];
  if (scale === undefined) throw Error("unknown kernel " + name);
  const path = build(name, scale);
  confirm(path);
  const native = best(path, []),
    node = best(process.execPath, [here + "node-run.ts", name, String(scale)]);
  if (native.status !== 42) throw Error("native run failed for " + name);
  const ts = native.seconds - nativeBase.seconds,
    ns = node.seconds - nodeBase.seconds,
    tc = (native.cycles - nativeBase.cycles) / 1e9,
    nc = (node.cycles - nodeBase.cycles) / 1e9;
  tintTotal += ts;
  nodeTotal += ns;
  console.log(
    name.padEnd(15) +
      ts.toFixed(2).padStart(8) +
      ns.toFixed(2).padStart(8) +
      (ts / ns).toFixed(2).padStart(7) +
      giga(tc * 1e9, 11) +
      giga(nc * 1e9, 11) +
      (counted ? (tc / nc).toFixed(2) : "-").padStart(7) +
      giga(native.instructions - nativeBase.instructions, 11) +
      giga(node.instructions - nodeBase.instructions, 11),
  );
}
console.log(
  "total".padEnd(15) +
    tintTotal.toFixed(2).padStart(8) +
    nodeTotal.toFixed(2).padStart(8) +
    (tintTotal / nodeTotal).toFixed(2).padStart(7),
);
