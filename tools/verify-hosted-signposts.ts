// Native evidence for collector signposts (docs/runtime-diagnostics.md).
// Builds a GC-heavy fixture with signposts, then records every process with
// `xctrace` (Logging template) while LLDB runs the fixture, and summarizes
// the fixture's os_signpost intervals per name and thread.
//   node tools/verify-hosted-signposts.ts <new-output-directory>
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
  console.log("Verified collector and allocation signposts in Instruments.");
}
