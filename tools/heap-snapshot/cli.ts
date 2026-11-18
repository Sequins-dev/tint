// External heap tooling for native Tint images (docs/native-heap-profiling.md).
//
//   node tools/heap-snapshot/cli.ts capture <image> --out <dir> [where]
//       [--debugger lldb|gdb] [-- args]
//       where: --after N,.. | --before N,.. | --after-majors | --before-majors
//              | --peak            (launch; collections are 1-based)
//              --pid <pid>         (attach; dump at the next allocation)
//              --core <file>       (a core saved inside an allocation slow
//                                   path, e.g. at __tint_allocation_sample)
//   node tools/heap-snapshot/cli.ts convert <dump> [--heapsnapshot <file>]
//       [--pprof <file>] [--report <file.json>] [--include-unreachable]
//   node tools/heap-snapshot/cli.ts allocations <image> --interval <bytes>
//       --out <profile.pb.gz> [--samples <file.jsonl>] [--max-samples N]
//       [--fixed] [--debugger lldb|gdb] [-- args]
//   node tools/heap-snapshot/cli.ts allocations --from <file.jsonl>
//       --out <profile.pb.gz> [--heapprofile <file.heapprofile>]
//   node tools/heap-snapshot/cli.ts cpu <profile.pb.gz> [--image <exe>]
//       [--cpuprofile <file.cpuprofile>] [--pprof <file.pb.gz>]
//       (a pprofessor CPU profile re-symbolised from the image's DWARF,
//        inlined frames included)
//   node tools/heap-snapshot/cli.ts perf <perf.data | perf-script.txt>
//       --image <exe> [--thread main|<tid>] [--cpuprofile <file.cpuprofile>]
//       [--pprof <file.pb.gz>] [--top N]
//       (Linux `perf record --call-graph fp|dwarf` samples, symbolised from
//        the image's DWARF the same way; see tools/profiling/perf-script.ts)
//
// The formats come from the shared profiling core (tools/profiling).
// Captures run LLDB with tools/lldb/tint.py (the default) or GDB with
// tools/gdb/tint.py (`--debugger gdb`), adapters of the same debugger-neutral
// core (tools/debugger/tint_heap.py), which reads the image's
// `__tint_heap_descriptor` and DWARF. Conversion needs only the dump and the
// executable. Heap snapshots load in Chrome DevTools (Memory > Load) and
// Memlab; profiles in `go tool pprof` and pprofessor.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HeapDump } from "./dump.ts";
import { buildGraph, reportTotals } from "./graph.ts";
import { analyze, report, type HeapAnalysis } from "../profiling/analysis.ts";
import { writeHeapSnapshot } from "../profiling/heapsnapshot.ts";
import { decodeProfile, encodeProfile } from "../profiling/pprof.ts";
import {
  attributePerfSamples,
  parsePerfScript,
  perfProfile,
  runPerfScript,
} from "../profiling/perf-script.ts";
import { imageSegments } from "./dump.ts";
import { heapDebugger, quote, runLldb } from "./debuggers.ts";
import {
  inUseSamples,
  readAllocationSamples,
} from "../profiling/heap-profiles.ts";
import {
  toCpuProfile,
  toSamplingHeapProfile,
} from "../profiling/devtools-profiles.ts";
import {
  normaliseLines,
  symbolised,
  type SourceLine,
} from "../profiling/samples.ts";

/** Generic (runtime-neutral) LLDB helpers shared with the DevTools bridge. */
export const devtoolsLldbModule = fileURLToPath(
  new URL("../lldb/devtools.py", import.meta.url),
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
function capture(args: string[]): void {
  const image = args[0],
    out = option(args, "--out");
  if (image === undefined || out === undefined)
    throw Error("usage: capture <image> --out <dir> ...");
  const debug = heapDebugger(option(args, "--debugger"));
  const pid = option(args, "--pid"),
    core = option(args, "--core");
  if (pid !== undefined) {
    const output = debug.run(undefined, [
      debug.attach(pid),
      "tint-heap arm 1",
      debug.breakAtSymbol("__tint_allocation_sample"),
      debug.resume,
      "tint-heap dump " + quote(resolve(out)),
      "tint-heap arm 0",
      debug.deleteBreakpoints,
      debug.detach,
    ]);
    console.log(output.match(/dumped heap[^\n]*/)?.[0] ?? output);
    return;
  }
  if (core !== undefined) {
    const output = debug.run(
      image,
      ["tint-heap dump " + quote(resolve(out))],
      debug.coreArguments(core),
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
  const output = debug.run(image, [
    debug.launchAtEntry(programArguments(args)),
    "tint-heap snapshot-points --out " +
      quote(resolve(out)) +
      " " +
      points.join(" "),
  ]);
  console.log(output.match(/TINTHEAP[^\n]*/)?.[0] ?? output);
}

/** pprof inuse_objects/inuse_space by dominator path (see inUseSamples). */
export function inUseProfile(analysis: HeapAnalysis): Uint8Array {
  return encodeProfile(inUseSamples(analysis));
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
  const summary = report(analysis, directory, 40, reportTotals(graph));
  if (reportPath !== undefined)
    writeFileSync(reportPath, JSON.stringify(summary, null, 1));
  const totals = summary.totals;
  console.log(
    `objects ${totals.objects} (${totals.bytes} bytes; headers ${totals.headerBytes}), reachable ${totals.reachableObjects} (${totals.reachableBytes} bytes), ${totals.edges} edges, ${totals.rootReferences} stack roots, ${(Date.now() - started) / 1000}s`,
  );
}

/** pprof alloc_objects/alloc_space from a sample file (see
 * readAllocationSamples). */
export function allocationProfile(path: string): {
  profile: Uint8Array;
  samples: number;
  bytes: number;
} {
  const { profile, bytes } = readAllocationSamples(path);
  return {
    profile: encodeProfile(profile),
    samples: profile.samples.length,
    bytes,
  };
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
    const debug = heapDebugger(option(args, "--debugger"));
    const output = debug.run(image, [
      debug.launchAtEntry(programArguments(args)),
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
  const heapProfile = option(args, "--heapprofile");
  if (heapProfile !== undefined) {
    writeFileSync(
      heapProfile,
      JSON.stringify(
        toSamplingHeapProfile(readAllocationSamples(samplesPath).profile),
      ),
    );
    console.log(heapProfile);
  }
  console.log(
    `${out}: ${result.samples} samples, ~${Math.round(result.bytes / 1048576)} MiB allocated`,
  );
}

/** Symbolises addresses with LLDB from the image's DWARF: each address's
 * lines, innermost inlined callee first, with the function's start line. */
export function lldbSymbolizer(
  image: string,
  addresses: readonly number[],
  slide = 0,
): Map<number, SourceLine[]> {
  const unique = [...new Set(addresses)].filter((address) => address !== 0);
  const result = new Map<number, SourceLine[]>();
  if (unique.length === 0) return result;
  const output = runLldb(image, [
    "command script import " + devtoolsLldbModule,
    "devtools symbolize " +
      unique.map((address) => "0x" + (address - slide).toString(16)).join(" "),
  ]);
  const line = output.split("\n").find((text) => text.startsWith("DEVTOOLS "));
  if (line === undefined) throw Error("lldb symbolization failed:\n" + output);
  const parsed = JSON.parse(line.slice(9)) as Record<
    string,
    Parameters<typeof normaliseLines>[0]
  >;
  for (const [key, lines] of Object.entries(parsed))
    result.set(Number(key) + slide, normaliseLines(lines));
  return result;
}

/** The runtime slide of an image mapping: its start minus the linked
 * address of the mapped file offset (Mach-O __TEXT at 0x100000000; ELF
 * PT_LOAD segments by their headers). */
export function mappingSlide(
  mapping: { readonly start: number; readonly offset: number },
  image: Buffer,
): number {
  for (const segment of imageSegments(image))
    if (
      mapping.offset >= segment.fileOffset &&
      mapping.offset < segment.fileOffset + Math.max(segment.fileSize, 1)
    )
      return (
        mapping.start - (segment.address + mapping.offset - segment.fileOffset)
      );
  return mapping.start - 0x100000000;
}

/** Linux perf samples as a DevTools .cpuprofile and/or pprof profile, with
 * DWARF lines and inlined frames from --image. */
function perf(args: string[]): void {
  const input = args[0],
    image = option(args, "--image");
  if (input === undefined || image === undefined)
    throw Error(
      "usage: perf <perf.data | perf-script.txt> --image <exe> [--thread main|<tid>] [--cpuprofile <file>] [--pprof <file>] [--top N]",
    );
  let text: string;
  if (readFileSync(input).subarray(0, 8).toString("latin1") === "PERFILE2") {
    text = runPerfScript(input);
  } else text = readFileSync(input, "utf8");
  const samples = parsePerfScript(text);
  const chosen = option(args, "--thread"),
    thread =
      chosen === undefined
        ? undefined
        : chosen === "main"
          ? ("main" as const)
          : Number(chosen);
  const profile = perfProfile(samples, {
    image: resolve(image),
    thread,
    symbolise: (addresses) => lldbSymbolizer(image, addresses),
  });
  const cpuprofile = option(args, "--cpuprofile"),
    pprof = option(args, "--pprof");
  if (cpuprofile !== undefined) {
    writeFileSync(cpuprofile, JSON.stringify(toCpuProfile(profile)));
    console.log(cpuprofile + ": " + profile.samples.length + " samples");
  }
  if (pprof !== undefined) {
    writeFileSync(pprof, encodeProfile(profile));
    console.log(pprof);
  }
  const top = Number(option(args, "--top") ?? "10");
  const leaves = attributePerfSamples(samples, thread ?? "main");
  console.log(
    leaves.samples + " samples on the thread; exclusive leaf functions:",
  );
  for (const group of leaves.leafGroups.slice(0, top))
    console.log(group.percent.toFixed(1).padStart(6) + "%  " + group.function);
}

/** A pprof CPU profile (pprofessor's) as a DevTools .cpuprofile and/or a
 * re-symbolised pprof, with DWARF lines and inlined frames from --image. */
function cpu(args: string[]): void {
  const input = args[0];
  if (input === undefined)
    throw Error(
      "usage: cpu <profile.pb.gz> [--image <exe>] [--cpuprofile <file>] [--pprof <file>]",
    );
  let profile = decodeProfile(readFileSync(input));
  const image = option(args, "--image");
  if (image !== undefined) {
    const mapping = (profile.mappings ?? []).find(
      (entry) => resolve(entry.file) === resolve(image),
    );
    const slide =
      mapping === undefined ? 0 : mappingSlide(mapping, readFileSync(image));
    const addresses: number[] = [];
    for (const sample of profile.samples)
      for (const location of sample.stack)
        if (
          location.address !== undefined &&
          (mapping === undefined ||
            (location.address >= mapping.start &&
              location.address < mapping.limit))
        )
          addresses.push(location.address);
    const symbols = lldbSymbolizer(image, addresses, slide);
    profile = symbolised(profile, (address) => symbols.get(address));
  }
  const cpuprofile = option(args, "--cpuprofile"),
    pprof = option(args, "--pprof");
  if (cpuprofile !== undefined) {
    writeFileSync(cpuprofile, JSON.stringify(toCpuProfile(profile)));
    console.log(cpuprofile + ": " + profile.samples.length + " samples");
  }
  if (pprof !== undefined) {
    writeFileSync(pprof, encodeProfile(profile));
    console.log(pprof);
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "capture") capture(rest);
  else if (command === "convert") convert(rest);
  else if (command === "allocations") allocations(rest);
  else if (command === "cpu") cpu(rest);
  else if (command === "perf") perf(rest);
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
