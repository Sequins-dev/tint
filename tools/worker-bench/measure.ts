// Rotated, paired Worker-performance runs (docs/results/worker-runtime-baseline-v1.md).
// Build the images first (build-native.ts), then run one set per lock hold:
//   tools/gate/with-lock.sh both worker-bench \
//     node tools/worker-bench/measure.ts <set> --rounds 15 --out <file.json> \
//       --image <variant>=<path> ...
// Sets and their runs (tint-* need an --image; node-* use NODE26):
//   kernels    tint-plain tint-copying tint-raw tint-main
//              node-plain node-raw node-main node-worker
//   worker     tint-worker node-worker
//   placements tint-plain tint-main tint-worker
//              node-plain node-main node-worker
//   transport  tint-transport node-transport
//   transport-steps tint-transport-a tint-transport-b tint-transport-c
//              node-transport
// Each round runs every member once; round r starts at member r mod n and
// odd rounds run in reverse. Native images run under LLDB, which must report
// the stop at entry and exit status 42; Node must exit 42. Every observation,
// including failures, is written to the output with the round's load average.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { kernelNames, kernelScale, runKernel } from "./kernels.ts";
import { rawKernelNames, rawKernelScale, runRawKernel } from "./raw-kernels.ts";

const sets: Record<string, readonly string[]> = {
  kernels: [
    "tint-plain",
    "tint-copying",
    "tint-raw",
    "tint-main",
    "node-plain",
    "node-raw",
    "node-main",
    "node-worker",
  ],
  worker: ["tint-worker", "node-worker"],
  // Once Workers no longer tax their code, every placement fits one set.
  placements: [
    "tint-plain",
    "tint-main",
    "tint-worker",
    "node-plain",
    "node-main",
    "node-worker",
  ],
  transport: ["tint-transport", "node-transport"],
  // Successive transport images (--image transport-a=… -b=… -c=…).
  "transport-steps": [
    "tint-transport-a",
    "tint-transport-b",
    "tint-transport-c",
    "node-transport",
  ],
};
const argv = process.argv.slice(2);
const set = argv[0] ?? "";
const members = sets[set];
if (members === undefined) throw Error("unknown set " + set);
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
}
const rounds = Number(option("--rounds") ?? "15");
const out = option("--out");
if (!Number.isSafeInteger(rounds) || rounds < 1 || out === undefined)
  throw Error("usage: measure.ts <set> --rounds N --out FILE --image v=path");
const images = new Map<string, string>();
argv.forEach((value, index) => {
  if (argv[index - 1] !== "--image") return;
  const split = value.indexOf("=");
  images.set(value.slice(0, split), value.slice(split + 1));
});
const node = process.env.NODE26 ?? "/opt/homebrew/bin/node";
const nodeVersion = spawnSync(node, ["--version"], {
  encoding: "utf8",
}).stdout.trim();
if (nodeVersion !== "v26.13.1")
  throw Error("NODE26 must be Node 26.13.1, found " + nodeVersion);
const runner = fileURLToPath(new URL("./node-run.ts", import.meta.url));
const expected = {
  base: kernelNames.map((name) => runKernel(name, kernelScale(name))),
  raw: rawKernelNames().map((name) => runRawKernel(name, rawKernelScale(name))),
};
const imageInfo: Record<string, { path: string; sha256: string }> = {};
for (const member of members) {
  if (!member.startsWith("tint-")) continue;
  const path = images.get(member.slice(5));
  if (path === undefined) throw Error("missing --image for " + member);
  imageInfo[member] = {
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

interface Observation {
  readonly member: string;
  readonly status: number | null;
  readonly passed: boolean;
  readonly wallMs: number;
  readonly lines: readonly string[];
  readonly stderr: string;
}
const environment = { ...process.env, TZ: "UTC" };
function launch(member: string): Observation {
  const variant = member.slice(5);
  const started = performance.now();
  if (member.startsWith("node-")) {
    const list = variant === "raw" ? expected.raw : expected.base;
    const result = spawnSync(
      node,
      variant === "transport"
        ? [runner, variant]
        : [runner, variant, JSON.stringify(list)],
      { encoding: "utf8", env: environment, timeout: 1800000 },
    );
    return {
      member,
      status: result.status,
      passed: result.status === 42,
      wallMs: performance.now() - started,
      lines: result.stdout.split("\n").filter((l) => l.startsWith("WORKER_")),
      stderr: result.stderr.slice(-4000),
    };
  }
  const image = imageInfo[member];
  if (image === undefined) throw Error("image invariant " + member);
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "settings set target.disable-aslr false",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped; print('WORKER_BENCH_STOPPED')",
      "-o",
      "continue",
      "-o",
      "script print('WORKER_BENCH_EXIT', lldb.process.GetState() == lldb.eStateExited, lldb.process.GetExitStatus())",
      image.path,
    ],
    { encoding: "utf8", env: environment, timeout: 1800000 },
  );
  const lines = result.stdout
    .split("\n")
    .filter((l) => l.startsWith("WORKER_"));
  return {
    member,
    status: result.status,
    passed:
      result.status === 0 &&
      lines.includes("WORKER_BENCH_STOPPED") &&
      lines.includes("WORKER_BENCH_EXIT True 42"),
    wallMs: performance.now() - started,
    lines,
    stderr: result.stderr.slice(-4000),
  };
}

const record = {
  set,
  date: new Date().toISOString(),
  platform: process.platform + "-" + process.arch,
  node: nodeVersion,
  images: imageInfo,
  rounds: [] as {
    round: number;
    order: string[];
    load: number[];
    observations: Observation[];
  }[],
};
for (let round = 0; round < rounds; round++) {
  const order = members.map(
    (_member, i) => members[(round + i) % members.length] as string,
  );
  if (round % 2 === 1) order.reverse();
  const load = loadavg();
  const observations: Observation[] = [];
  for (const member of order) {
    const observation = launch(member);
    observations.push(observation);
    console.log(
      `round ${round + 1}/${rounds} ${member} ${observation.passed ? "ok" : "FAILED"} ${(observation.wallMs / 1000).toFixed(1)} s load ${load[0]?.toFixed(2)}`,
    );
  }
  record.rounds.push({ round, order, load, observations });
  writeFileSync(out, JSON.stringify(record, null, 1) + "\n");
}
const failures = record.rounds.flatMap((round) =>
  round.observations.filter((observation) => !observation.passed),
);
if (failures.length !== 0) {
  console.log(failures.length + " failed observations (kept in " + out + ")");
  process.exitCode = 1;
}
