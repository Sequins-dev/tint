// Native evidence for collector signposts (docs/runtime-diagnostics.md).
// Builds a GC-heavy fixture with signposts for the host target. On macOS it
// records every process with `xctrace` (Logging template) while LLDB runs
// the fixture, and summarizes the fixture's os_signpost intervals per name
// and thread, and the collection metrics each gc.collect interval ends
// with. On Linux it lists the image's USDT probes and counts their hits
// under GDB (tools/gdb/tint-probes.py), which needs no kernel uprobes.
//   node tools/verify-hosted-signposts.ts <new-output-directory>
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

/** Builds lists that die young, with a few survivors, so the generational
 * runtime runs minor collections, majors and its parallel evacuator. */
export const signpostFixture = `interface Node { readonly value: number; readonly next: Node | undefined; }
export function run():number {
  let keep: Node | undefined = undefined, total = 0;
  for (let round = 0; round < 400; round++) {
    let list: Node | undefined = undefined;
    for (let i = 0; i < 20000; i++) list = { value: i, next: list };
    if (round % 50 === 0) keep = { value: round, next: keep };
    total += list === undefined ? 0 : list.value;
  }
  return total === 400 * 19999 && keep !== undefined ? 42 : 1;
}
`;
export function buildSignpostFixture(name: string): string {
  return verifyHostedFixture(signpostFixture, name, [], [], [], [], {
    managedBytes: 16777216,
    allocationCapacity: 1048576,
    runtimeEntry: "initializeGenerationalRuntime",
    signposts: true,
  });
}
/** LLDB launch of an image that must exit with status 42. */
export function runUnderLldb(image: string): string {
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped",
      "-o",
      "continue",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
      image,
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exited with status = 42 /);
  return result.stdout;
}

/** USDT probe hits of one run under GDB (tools/gdb/tint-probes.py). */
export interface ProbeRun {
  readonly exitCode: number | null;
  /** Probes the image's notes list. */
  readonly listed: readonly string[];
  readonly probes: Readonly<
    Record<string, { readonly count: number; readonly threads: number }>
  >;
  /** gc__end arguments: major, nursery, copied and old bytes. */
  readonly collections: readonly (readonly number[])[];
  readonly session: string;
}
const probeScript = fileURLToPath(
  new URL("./gdb/tint-probes.py", import.meta.url),
);
/** Runs an image to completion under GDB with every `tint` probe counted. */
export function recordProbesUnderGdb(image: string): ProbeRun {
  const out = join(dirname(image), "probes.json");
  const result = spawnSync(
    "gdb",
    ["-q", "-batch", "-nx", "-x", probeScript, image],
    {
      encoding: "utf8",
      timeout: 600000,
      env: { ...process.env, TINT_PROBES_OUT: out },
    },
  );
  assert.equal(result.error, undefined);
  const session = result.stdout + result.stderr;
  assert.equal(result.status, 0, session);
  const summary = JSON.parse(readFileSync(out, "utf8")) as Omit<
    ProbeRun,
    "session"
  >;
  return { ...summary, session };
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
interface Interval {
  readonly name: string;
  readonly thread: string;
}
/** Rows of an exported OSSignpostIntervals table for one process. The export
 * writes each value once (id + fmt) and refers back to it (ref) later. */
export function signpostIntervals(
  xml: string,
  processName: string,
): Interval[] {
  const formatted = new Map<string, string>();
  const result: Interval[] = [];
  for (const row of xml.split("<row>").slice(1)) {
    for (const value of row.matchAll(/ id="(\d+)" fmt="([^"]*)"/g))
      formatted.set(value[1] ?? "", value[2] ?? "");
    function first(element: string): string {
      const match = new RegExp(
        "<" + element + ' (?:id="(\\d+)"|ref="(\\d+)")',
      ).exec(row);
      return formatted.get(match?.[1] ?? match?.[2] ?? "") ?? "";
    }
    const name = first("signpost-name"),
      owner = first("process");
    if (name === "" || !owner.startsWith(processName + " (")) continue;
    result.push({ name, thread: first("thread") });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output)
    throw Error(
      "usage: node tools/verify-hosted-signposts.ts <new-output-directory>",
    );
  mkdirSync(output);
  process.env.TINT_BUILD_ONLY = "1";
  const image = buildSignpostFixture("signposts-gc-v1");
  // Correctness first: the instrumented runtime still completes.
  runUnderLldb(image);
  if (process.platform === "linux") verifyProbes(image, output);
  else await verifyXctrace(image, output);
}

/** Linux: the USDT probes' notes, hits and collection metrics. */
function verifyProbes(image: string, output: string): void {
  const notes = spawnSync("readelf", ["--notes", image], { encoding: "utf8" });
  assert.equal(notes.status, 0, notes.stderr);
  writeFileSync(resolve(output, "notes.txt"), notes.stdout);
  const run = recordProbesUnderGdb(image);
  writeFileSync(resolve(output, "gdb.txt"), run.session);
  const metrics = run.collections.map((entry) => ({
    major: entry[0] === 1,
    nursery: entry[1] ?? 0,
    copied: entry[2] ?? 0,
    old: entry[3] ?? 0,
  }));
  const report = {
    image,
    exitCode: run.exitCode,
    probes: run.listed.length,
    collections: {
      withMetrics: metrics.length,
      majors: metrics.filter((entry) => entry.major).length,
      copiedBytes: metrics.reduce((sum, entry) => sum + entry.copied, 0),
    },
    names: run.probes,
  };
  writeFileSync(
    resolve(output, "summary.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  assert.equal(run.exitCode, 42);
  assertProbeRun(run);
  console.log("Verified collector and allocation USDT probes under GDB.");
}
/** Probe hits of the signpost fixture: balanced interval edges, metrics
 * from every collection. */
export function assertProbeRun(run: ProbeRun): void {
  for (const name of ["gc_collect", "gc_minor", "gc_roots", "alloc_slow"]) {
    const begin = run.probes[name + "__begin"]?.count ?? 0;
    assert.ok(begin > 0, "missing " + name + " probes");
    assert.equal(run.probes[name + "__end"]?.count, begin, name + " edges");
  }
  assert.equal(
    run.collections.length,
    run.probes["gc_collect__end"]?.count,
    "every collection reports its metrics",
  );
  for (const entry of run.collections) {
    const [major = -1, nursery = 0, copied = 0, old = 0] = entry;
    assert.ok(major === 0 || major === 1);
    assert.ok(nursery > 0 && old >= copied);
    if (major === 1) assert.equal(copied, old);
  }
}

/** macOS: os_signpost intervals recorded by xctrace. */
async function verifyXctrace(image: string, output: string): Promise<void> {
  const trace = resolve(output, "signposts.trace");
  const recorder = spawn(
    "xcrun",
    [
      "xctrace",
      "record",
      "--template",
      "Logging",
      "--all-processes",
      "--time-limit",
      "60s",
      "--output",
      trace,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let recorderLog = "";
  recorder.stdout.on("data", (chunk: Buffer) => (recorderLog += chunk));
  recorder.stderr.on("data", (chunk: Buffer) => (recorderLog += chunk));
  const finished = new Promise<number | null>((done) =>
    recorder.on("exit", (code) => done(code)),
  );
  // xctrace prints "Starting recording" once collection is live.
  for (
    let waited = 0;
    waited < 30000 && !/Starting recording/i.test(recorderLog);
    waited += 250
  ) {
    await new Promise((done) => setTimeout(done, 250));
  }
  sleep(1000);
  const session = runUnderLldb(image);
  sleep(1000);
  recorder.kill("SIGINT");
  const code = await finished;
  writeFileSync(resolve(output, "xctrace.log"), recorderLog);
  writeFileSync(resolve(output, "lldb.txt"), session);
  assert.equal(code, 0, recorderLog);
  const exported = spawnSync(
    "xcrun",
    [
      "xctrace",
      "export",
      "--input",
      trace,
      "--xpath",
      '/trace-toc/run[@number="1"]/data/table[@schema="OSSignpostIntervals"]',
    ],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );
  assert.equal(exported.status, 0, exported.stderr);
  const rows = signpostIntervals(exported.stdout, basename(image));
  // Collections end with their metrics (major, nursery, copied, old bytes;
  // xctrace groups digits).
  const metrics = [
    ...exported.stdout.matchAll(
      /major=([01]) nursery=([\d,]+) copied=([\d,]+) old=([\d,]+)/g,
    ),
  ].map((match) => ({
    major: match[1] === "1",
    nursery: Number((match[2] ?? "").replaceAll(",", "")),
    copied: Number((match[3] ?? "").replaceAll(",", "")),
    old: Number((match[4] ?? "").replaceAll(",", "")),
  }));
  const summary = new Map<string, { count: number; threads: Set<string> }>();
  for (const row of rows) {
    const entry = summary.get(row.name) ?? { count: 0, threads: new Set() };
    entry.count++;
    entry.threads.add(row.thread);
    summary.set(row.name, entry);
  }
  const report = {
    image,
    intervals: rows.length,
    collections: {
      withMetrics: metrics.length,
      majors: metrics.filter((entry) => entry.major).length,
      copiedBytes: metrics.reduce((sum, entry) => sum + entry.copied, 0),
    },
    names: Object.fromEntries(
      [...summary].map(([name, entry]) => [
        name,
        { count: entry.count, threads: entry.threads.size },
      ]),
    ),
  };
  writeFileSync(
    resolve(output, "summary.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  for (const name of [
    "gc.collect",
    "gc.minor",
    "gc.worker",
    "gc.roots",
    "alloc.slow",
  ])
    assert.ok(summary.has(name), "missing " + name + " intervals");
  assert.ok(
    (summary.get("gc.worker")?.threads.size ?? 0) > 1,
    "parallel workers report on their own threads",
  );
  assert.equal(
    metrics.length,
    summary.get("gc.collect")?.count,
    "every collection reports its metrics",
  );
  assert.ok(
    metrics.some((entry) => entry.major),
    "a major collection",
  );
  for (const entry of metrics) {
    assert.ok(entry.nursery > 0 && entry.old >= entry.copied);
    if (entry.major) assert.equal(entry.copied, entry.old);
  }
  console.log("Verified collector and allocation signposts in Instruments.");
}
