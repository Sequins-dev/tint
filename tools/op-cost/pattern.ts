// Operation cost analysis of one pattern-bench pattern:
//   node tools/op-cost/pattern.ts <pattern> [analyze.ts options...]
// Builds the pattern natively with operation ranges and debug symbols at its
// measure.ts iteration count, profiles it with pprofessor, then runs
// analyze.ts on the binary and profile.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const [pattern, ...rest] = process.argv.slice(2);
if (pattern === undefined)
  throw Error("usage: pattern.ts <pattern> [analyze options]");
const plan = readFileSync(here + "../pattern-bench/measure.ts", "utf8");
const iterations =
  new RegExp(pattern + ":\\s*\\{\\s*iterations:\\s*(\\d+)").exec(plan)?.[1] ??
  "1000";
const environment = {
  ...process.env,
  TZ: "UTC",
  TINT_BUILD_ONLY: "1",
  TINT_DEBUG_SYMBOLS: "1",
  TINT_OPERATION_RANGES: "1",
};
const built = spawnSync(
  process.execPath,
  [here + "../pattern-bench/build-native.ts", pattern, iterations],
  { encoding: "utf8", env: environment },
);
const binary = built.stdout.split("\n").find((line) => line.startsWith("/"));
if (built.status !== 0 || binary === undefined)
  throw Error("native build failed:\n" + built.stderr.slice(-2000));
const profile = binary + ".pb.gz";
const profiler = spawnSync(
  process.env.PPROFESSOR ??
    process.env.HOME + "/Code/swift/pprofessor/target/release/pprofessor",
  ["run", "--freq", "999", "--output", profile, "--", binary],
  { encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
);
if (profiler.status !== 0)
  console.error(`note: profiler exited ${profiler.status}`);
const analysis = spawnSync(
  process.execPath,
  [here + "analyze.ts", binary, "--profile", profile, ...rest],
  { encoding: "utf8", maxBuffer: 1 << 30 },
);
process.stdout.write(analysis.stdout);
process.stderr.write(analysis.stderr);
