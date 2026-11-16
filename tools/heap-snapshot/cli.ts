// External heap tooling for native Tint images (docs/native-heap-profiling.md).
//
//   node tools/heap-snapshot/cli.ts capture <image> --out <dir> [where] [-- args]
//       where: --after N,.. | --before N,.. | --after-majors | --before-majors
//              | --peak            (launch; collections are 1-based)
//              --pid <pid>         (attach; dump at the next allocation)
//              --core <file>       (a core saved inside an allocation slow
//                                   path, e.g. at __tint_allocation_sample)
//   node tools/heap-snapshot/cli.ts convert <dump> [--heapsnapshot <file>]
//       [--pprof <file>] [--report <file.json>] [--include-unreachable]
//   node tools/heap-snapshot/cli.ts allocations <image> --interval <bytes>
//       --out <profile.pb.gz> [--samples <file.jsonl>] [--max-samples N]
//       [--fixed] [-- args]
//   node tools/heap-snapshot/cli.ts allocations --from <file.jsonl>
//       --out <profile.pb.gz>
//
// Captures run LLDB with tools/lldb/tint.py, which reads the image's
// `__tint_heap_descriptor` and DWARF. Conversion needs only the dump and the
// executable. Heap snapshots load in Chrome DevTools (Memory > Load) and
// Memlab; profiles in `go tool pprof` and pprofessor.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HeapDump } from "./dump.ts";
import { buildGraph } from "./graph.ts";
import { analyze, report, typeName, type HeapAnalysis } from "./analysis.ts";
import { writeHeapSnapshot } from "./heapsnapshot.ts";
import { encodeProfile, type ProfileSample } from "./pprof.ts";

export const lldbModule = fileURLToPath(
  new URL("../lldb/tint.py", import.meta.url),
);

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function flag(args: string[], name: string): boolean {
  return args.includes(name);
}
function programArguments(args: string[]): string[] {
  const index = args.indexOf("--");
  return index >= 0 ? args.slice(index + 1) : [];
}
function quote(text: string): string {
  return "'" + text.replaceAll("'", "'\\''") + "'";
}

/** Runs LLDB in batch mode with the tint module; fails on a failed command. */
export function runLldb(
  image: string | undefined,
  commands: string[],
  extra: string[] = [],
): string {
  const args = [
    "--no-lldbinit",
    "--batch",
    "-o",
    "command script import " + lldbModule,
  ];
  for (const command of commands) args.push("-o", command);
  args.push(...extra);
  if (image !== undefined) args.push(image);
  const result = spawnSync("lldb", args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.error !== undefined) throw result.error;
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || /\berror: /.test(output))
    throw Error("lldb failed:\n" + output.slice(-4000));
  return output;
}

function capture(args: string[]): void {
  const image = args[0],
    out = option(args, "--out");
  if (image === undefined || out === undefined)
    throw Error("usage: capture <image> --out <dir> ...");
  const pid = option(args, "--pid"),
    core = option(args, "--core");
  if (pid !== undefined) {
    const output = runLldb(undefined, [
      "process attach --pid " + pid,
      "tint-heap arm 1",
      "breakpoint set --name __tint_allocation_sample",
      "continue",
      "tint-heap dump " + quote(resolve(out)),
      "tint-heap arm 0",
      "breakpoint delete --force",
      "process detach",
    ]);
    console.log(output.match(/dumped heap[^\n]*/)?.[0] ?? output);
    return;
  }
  if (core !== undefined) {
    const output = runLldb(
      image,
      ["tint-heap dump " + quote(resolve(out))],
      ["-c", core],
    );
    console.log(output.match(/dumped heap[^\n]*/)?.[0] ?? output);
    return;
  }
  const points: string[] = [];
  for (const name of ["--before", "--after"]) {
    const value = option(args, name);
    if (value !== undefined) points.push(name, value);
  }
  for (const name of ["--after-majors", "--before-majors", "--peak"])
    if (flag(args, name)) points.push(name);
  if (points.length === 0) points.push("--peak");
  const launch =
    "process launch --stop-at-entry" +
    (programArguments(args).length > 0
      ? " -- " + programArguments(args).map(quote).join(" ")
      : "");
  const output = runLldb(image, [
    launch,
    "tint-heap snapshot-points --out " +
      quote(resolve(out)) +
      " " +
      points.join(" "),
  ]);
  console.log(output.match(/TINTHEAP[^\n]*/)?.[0] ?? output);
}

/** In-use space by dominator path: each object's stack is its type, then
 * the types of its dominator chain (consecutive equal types merged) up to
 * the stack frame that retains it, so a flame graph shows who retains
 * memory. */
export function inUseProfile(analysis: HeapAnalysis): Uint8Array {
  const graph = analysis.graph,
    objectBase = analysis.objectBase,
    maxDepth = 64;
  const parent = new Int32Array(analysis.total).fill(-1),
    head = new Int32Array(analysis.total).fill(-1),
    depth = new Uint16Array(analysis.total);
  const paths: { name: string; parent: number }[] = [],
    pathIds = new Map<string, number>();
  const pathOf = (name: string, under: number): number => {
    const key = name + "\0" + under,
      known = pathIds.get(key);
    if (known !== undefined) return known;
    paths.push({ name, parent: under });
    pathIds.set(key, paths.length - 1);
    return paths.length - 1;
  };
  const counts = new Map<number, [number, number]>();
  for (const node of analysis.order) {
    if (node === 0) continue;
    const dominator = analysis.idom[node] ?? 0,
      name = typeName(analysis, node),
      above = dominator === 0 ? -1 : (head[dominator] ?? -1);
    let path: number;
    if (above >= 0 && paths[above]?.name === name) path = above;
    else if (above >= 0 && (depth[dominator] ?? 0) >= maxDepth) path = above;
    else path = pathOf(name, above);
    head[node] = path;
    depth[node] =
      (above >= 0 ? (depth[dominator] ?? 0) : 0) + (path === above ? 0 : 1);
    parent[node] = dominator;
    if (node >= objectBase) {
      const entry = counts.get(path) ?? [0, 0];
      entry[0] += 1;
      entry[1] += graph.size[node - objectBase] ?? 0;
      counts.set(path, entry);
    }
  }
  const samples: ProfileSample[] = [];
  for (const [path, [objects, bytes]] of counts) {
    const stack = [];
    for (let at = path; at >= 0; at = paths[at]?.parent ?? -1)
      stack.push({ lines: [{ function: paths[at]?.name ?? "?" }] });
    samples.push({ stack, values: [objects, bytes] });
  }
  return encodeProfile({
    sampleTypes: [
      { type: "inuse_objects", unit: "count" },
      { type: "inuse_space", unit: "bytes" },
    ],
    samples,
    defaultSampleType: "inuse_space",
    comments: [
      "Tint heap snapshot: stacks are dominator paths of object types",
    ],
    timeNanos: Math.round(analysis.graph.dump.meta.time * 1e9),
  });
}

export function convert(args: string[]): void {
  const directory = args[0];
  if (directory === undefined) throw Error("usage: convert <dump> ...");
  const started = Date.now();
  const dump = new HeapDump(directory, option(args, "--image")),
    graph = buildGraph(dump),
    analysis = analyze(graph);
  const snapshot = option(args, "--heapsnapshot"),
    profile = option(args, "--pprof"),
    reportPath = option(args, "--report");
  if (snapshot !== undefined) {
    const totals = writeHeapSnapshot(analysis, snapshot, {
      includeUnreachable: flag(args, "--include-unreachable"),
    });
    console.log(
      `${snapshot}: ${totals.nodes} nodes, ${totals.edges} edges, ${totals.objects} objects, ${totals.bytes} bytes`,
    );
  }
  if (profile !== undefined) {
    writeFileSync(profile, inUseProfile(analysis));
    console.log(profile);
  }
  const summary = report(analysis, directory);
  if (reportPath !== undefined)
    writeFileSync(reportPath, JSON.stringify(summary, null, 1));
  const totals = summary.totals;
  console.log(
    `objects ${totals.objects} (${totals.bytes} bytes; headers ${totals.headerBytes}), reachable ${totals.reachableObjects} (${totals.reachableBytes} bytes), ${totals.edges} edges, ${totals.rootReferences} stack roots, ${(Date.now() - started) / 1000}s`,
  );
}

interface SampleRecord {
  readonly address: number;
  readonly size: number;
  readonly young: boolean;
  readonly type: string | null;
  readonly stack: readonly {
    readonly pc: number;
    readonly lines: readonly {
      readonly function: string;
      readonly file: string | null;
      readonly line: number;
    }[];
  }[];
}

/** pprof alloc_objects/alloc_space from sampled allocations. Each nursery
 * sample stands for 1 / (1 - exp(-size / interval)) objects (Poisson
 * sampling over allocated bytes); allocations placed directly in the old
 * space always take the slow path and count once. */
export function allocationProfile(path: string): {
  profile: Uint8Array;
  samples: number;
  bytes: number;
} {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean),
    header = JSON.parse(lines[0] ?? "{}") as {
      interval: number;
      image: { path: string; loadAddress: number; uuid: string };
    };
  const samples: ProfileSample[] = [];
  let estimated = 0;
  for (const line of lines.slice(1)) {
    const record = JSON.parse(line) as SampleRecord;
    const weight = record.young
      ? 1 / (1 - Math.exp(-record.size / header.interval))
      : 1;
    estimated += weight * record.size;
    samples.push({
      stack: record.stack.map((frame) => ({
        address: frame.pc,
        lines: frame.lines.map((entry) => ({
          function: entry.function,
          file: entry.file ?? undefined,
          line: entry.line,
        })),
      })),
      values: [weight, weight * record.size],
      labels: {
        type: record.type ?? "(unknown)",
        space: record.young ? "nursery" : "old",
      },
    });
  }
  const profile = encodeProfile({
    sampleTypes: [
      { type: "alloc_objects", unit: "count" },
      { type: "alloc_space", unit: "bytes" },
    ],
    samples,
    periodType: { type: "space", unit: "bytes" },
    period: header.interval,
    defaultSampleType: "alloc_space",
    mapping: {
      start: header.image.loadAddress,
      limit: header.image.loadAddress + 0x100000000,
      offset: 0,
      file: header.image.path,
      buildId: header.image.uuid,
    },
    comments: ["Tint allocation samples via __tint_allocation_sample"],
  });
  return { profile, samples: samples.length, bytes: estimated };
}

function allocations(args: string[]): void {
  const out = option(args, "--out");
  if (out === undefined) throw Error("--out is required");
  let samplesPath = option(args, "--from");
  if (samplesPath === undefined) {
    const image = args[0],
      interval = option(args, "--interval");
    if (image === undefined || interval === undefined)
      throw Error("usage: allocations <image> --interval <bytes> --out <file>");
    samplesPath = option(args, "--samples") ?? out + ".samples.jsonl";
    const extra =
      (option(args, "--max-samples") === undefined
        ? ""
        : " --max-samples " + option(args, "--max-samples")) +
      (flag(args, "--fixed") ? " --fixed" : "");
    const launch =
      "process launch --stop-at-entry" +
      (programArguments(args).length > 0
        ? " -- " + programArguments(args).map(quote).join(" ")
        : "");
    const output = runLldb(image, [
      launch,
      "tint-heap sample --interval " +
        interval +
        " --out " +
        quote(resolve(samplesPath)) +
        extra,
    ]);
    console.log(output.match(/TINTHEAP[^\n]*/)?.[0] ?? output);
  }
  const result = allocationProfile(samplesPath);
  writeFileSync(out, result.profile);
  console.log(
    `${out}: ${result.samples} samples, ~${Math.round(result.bytes / 1048576)} MiB allocated`,
  );
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "capture") capture(rest);
  else if (command === "convert") convert(rest);
  else if (command === "allocations") allocations(rest);
  else {
    console.error(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("//"))
        .join("\n"),
    );
    process.exitCode = 2;
  }
}
