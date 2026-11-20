// Live USDT tracing of Tint's collector and allocation probes on Linux
// (docs/runtime-diagnostics.md, "Linux USDT probes").
//
//   node tools/linux/verify-usdt-live.ts <new-output-directory>
//       [--image <signposted image>] [--static-only]
//
// Builds the GC-heavy signpost fixture (tools/verify-hosted-signposts.ts) for
// the host, or takes a prebuilt one with --image, then:
//
//   static  parses the image's `.note.stapsdt` notes itself (provider `tint`,
//           no semaphores, `.stapsdt.base` at the notes' base, a `nop` at
//           every probe site, the documented argument specs) and checks that
//           readelf, `perf list sdt` (through a temporary build-id cache
//           entry) and `bpftrace -l` list the same probes;
//   gdb     runs the image under GDB with every probe counted
//           (tools/gdb/tint-probes.py, no kernel support needed): the
//           reference counts and gc__end metrics, exit status 42;
//   perf    `perf probe -x <image> %sdt_tint:<name>` for every probe, then
//           `perf record -e 'sdt_tint:*'` and `perf script`;
//   bpftrace  `usdt:<image>:tint:*` counting probes, worker threads and
//           printing gc__end's arguments.
//
// perf and bpftrace attach uprobes: they need a kernel with
// CONFIG_UPROBE_EVENTS, tracefs mounted, a 4 KiB or 16 KiB page size (Tint
// images reject 64 KiB pages) and root (commands run through `sudo -n`
// unless already root). Their counts must equal GDB's for every probe
// (gc.worker edges only need to balance and span several threads), and
// their gc__end metrics must equal GDB's in order. When the kernel has no
// uprobes the static checks still run and the script exits 77 (skipped)
// after saying why; --static-only stops after them with status 0.
// Results go to <output>/summary.json with each tool's raw output.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSegments } from "../heap-snapshot/dump.ts";
import {
  assertProbeRun,
  buildSignpostFixture,
  recordProbesUnderGdb,
  type ProbeRun,
} from "../verify-hosted-signposts.ts";

const PROVIDER = "tint";
const SKIPPED = 77;
const FIXTURE_EXIT_CODE = 42;

export interface StapsdtProbe {
  readonly provider: string;
  readonly name: string;
  readonly location: number;
  readonly base: number;
  readonly semaphore: number;
  readonly arguments: string;
}

interface Section {
  readonly name: string;
  readonly address: number;
  readonly offset: number;
  readonly size: number;
}

function sections(image: Buffer): Section[] {
  const offset = Number(image.readBigUInt64LE(40)),
    entrySize = image.readUInt16LE(58),
    count = image.readUInt16LE(60),
    namesIndex = image.readUInt16LE(62);
  const raw = [];
  for (let index = 0; index < count; index++) {
    const at = offset + index * entrySize;
    raw.push({
      nameOffset: image.readUInt32LE(at),
      address: Number(image.readBigUInt64LE(at + 16)),
      offset: Number(image.readBigUInt64LE(at + 24)),
      size: Number(image.readBigUInt64LE(at + 32)),
    });
  }
  const names = raw[namesIndex];
  assert.ok(names !== undefined, "section name table");
  return raw.map((section) => {
    const start = names.offset + section.nameOffset;
    return {
      name: image.toString("latin1", start, image.indexOf(0, start)),
      address: section.address,
      offset: section.offset,
      size: section.size,
    };
  });
}

/** The SystemTap SDT v3 notes of an ELF image. */
export function stapsdtProbes(image: Buffer): StapsdtProbe[] {
  const notes = sections(image).find(
    (section) => section.name === ".note.stapsdt",
  );
  if (notes === undefined) return [];
  const probes: StapsdtProbe[] = [];
  const align = (value: number): number => (value + 3) & ~3;
  for (let at = notes.offset; at < notes.offset + notes.size;) {
    const nameSize = image.readUInt32LE(at),
      descSize = image.readUInt32LE(at + 4),
      type = image.readUInt32LE(at + 8);
    const owner = image.toString("latin1", at + 12, at + 12 + nameSize - 1);
    const desc = at + 12 + align(nameSize);
    if (owner === "stapsdt" && type === 3) {
      const strings = image
        .toString("latin1", desc + 24, desc + descSize)
        .split("\0");
      probes.push({
        location: Number(image.readBigUInt64LE(desc)),
        base: Number(image.readBigUInt64LE(desc + 8)),
        semaphore: Number(image.readBigUInt64LE(desc + 16)),
        provider: strings[0] ?? "",
        name: strings[1] ?? "",
        arguments: strings[2] ?? "",
      });
    }
    at = desc + align(descSize);
  }
  return probes;
}

/** Interval probes carry the interval id; gc__end the collection metrics;
 * alloc__sample (heap introspection) the allocation. */
function expectedArguments(name: string, x64: boolean): string {
  if (x64)
    return name === "gc__end" ? "8@%r8 8@%r9 8@%r10 8@%r11 8@%rbp" : "8@%rbp";
  if (name === "gc__end") return "8@x10 8@x11 8@x12 8@x13 8@x9";
  if (name === "alloc__sample") return "8@x0 8@x1 8@x2";
  return "8@x9";
}

function run(
  command: string,
  args: readonly string[],
  privileged = false,
): SpawnSyncReturns<string> {
  const elevate = privileged && process.getuid?.() !== 0;
  const result = spawnSync(
    elevate ? "sudo" : command,
    elevate ? ["-n", command, ...args] : args,
    { encoding: "utf8", maxBuffer: 1 << 28, timeout: 600000 },
  );
  if (result.error !== undefined) throw result.error;
  return result;
}

function succeed(
  command: string,
  args: readonly string[],
  privileged = false,
): string {
  const result = run(command, args, privileged);
  assert.equal(
    result.status,
    0,
    [command, ...args].join(" ") + "\n" + result.stdout + result.stderr,
  );
  return result.stdout + result.stderr;
}

interface StaticResult {
  readonly probes: readonly StapsdtProbe[];
  readonly names: readonly string[];
  readonly buildId: string;
}

/** perf can list a probe with or without its image and short build ID.
 * A cache containing only the fixture makes unsuffixed names unambiguous. */
export function perfListedProbeNames(list: string, shortId: string): string[] {
  return [
    ...list.matchAll(
      /^\s*sdt_tint:(\w+)(?:@\S+\(([0-9a-f]+)\))?[^\S\n]+\[SDT event\]/gm,
    ),
  ]
    .filter((match) => match[2] === undefined || match[2] === shortId)
    .map((match) => match[1] ?? "")
    .sort();
}

/** The image's own notes, then readelf, perf and bpftrace listings. */
function verifyStatic(image: string, output: string): StaticResult {
  const bytes = readFileSync(image);
  const x64 = bytes.readUInt16LE(18) === 62;
  const nopBytes = x64 ? 1 : 4;
  const probes = stapsdtProbes(bytes);
  assert.ok(probes.length > 0, "the image has no USDT probes");
  const base = sections(bytes).find(
    (section) => section.name === ".stapsdt.base",
  );
  assert.ok(base !== undefined, ".stapsdt.base");
  const segments = imageSegments(bytes);
  for (const probe of probes) {
    const label = probe.provider + ":" + probe.name;
    assert.equal(probe.provider, PROVIDER, label);
    assert.equal(probe.semaphore, 0, label + " has no semaphore");
    assert.equal(probe.base, base.address, label + " base");
    assert.equal(probe.arguments, expectedArguments(probe.name, x64), label);
    const segment = segments.find(
      (entry) =>
        probe.location >= entry.address &&
        probe.location + nopBytes <= entry.address + entry.fileSize,
    );
    assert.ok(segment !== undefined, label + " site is mapped");
    const offset = segment.fileOffset + probe.location - segment.address;
    const instruction = x64
      ? bytes.readUInt8(offset)
      : bytes.readUInt32LE(offset);
    assert.equal(
      instruction,
      x64 ? 0x90 : 0xd503201f,
      label + " site is a nop",
    );
  }
  const names = [...new Set(probes.map((probe) => probe.name))].sort();
  assert.equal(names.length, probes.length, "one site per probe");
  for (const name of ["gc_collect", "gc_minor", "gc_major", "alloc_slow"])
    for (const edge of ["__begin", "__end"])
      assert.ok(names.includes(name + edge), "missing " + name + edge);
  assert.ok(names.includes("gc__end"), "missing gc__end");

  const readelf = succeed("readelf", ["--notes", image]);
  writeFileSync(join(output, "readelf-notes.txt"), readelf);
  const listed = [...readelf.matchAll(/^\s+Name: (\S+)$/gm)]
    .map((match) => match[1] ?? "")
    .sort();
  assert.deepEqual(listed, names, "readelf lists the same probes");

  const buildId = /Build ID: ([0-9a-f]+)/.exec(readelf)?.[1];
  assert.ok(buildId !== undefined, "a GNU build ID");
  // A private cache makes unsuffixed event names unambiguous and keeps
  // this check independent of the user's existing cache entries.
  const cache = join(dirname(image), "perf-cache");
  const perf = ["--buildid-dir", cache];
  succeed("perf", [...perf, "buildid-cache", "--add", image]);
  const perfList = succeed("perf", [...perf, "list", "sdt"]);
  writeFileSync(join(output, "perf-list-sdt.txt"), perfList);
  const perfNames = perfListedProbeNames(perfList, buildId.slice(0, 12));
  assert.deepEqual(perfNames, names, "perf list sdt lists the same probes");

  const bpftrace = succeed("bpftrace", ["-l", "usdt:" + image + ":*"], true);
  writeFileSync(join(output, "bpftrace-list.txt"), bpftrace);
  const bpfNames = [
    ...bpftrace.matchAll(new RegExp(":" + PROVIDER + ":(\\S+)$", "gm")),
  ]
    .map((match) => match[1] ?? "")
    .sort();
  assert.deepEqual(bpfNames, names, "bpftrace -l lists the same probes");
  return { probes, names, buildId };
}

/** Why live uprobe tracing cannot run here, or undefined when it can. */
function liveUnavailable(): string | undefined {
  const page = Number(succeed("getconf", ["PAGESIZE"]).trim());
  if (page > 16384)
    return `the kernel's ${page}-byte pages are rejected by Tint images`;
  const tracefs = run(
    "sh",
    [
      "-c",
      "test -e /sys/kernel/tracing/uprobe_events || test -e /sys/kernel/debug/tracing/uprobe_events",
    ],
    true,
  );
  if (tracefs.status !== 0)
    return (
      "no uprobe_events in tracefs (kernel without CONFIG_UPROBE_EVENTS, " +
      "or tracefs not mounted: mount -t tracefs nodev /sys/kernel/tracing)" +
      (tracefs.stderr.includes("sudo") ? ": " + tracefs.stderr.trim() : "")
    );
  return undefined;
}

export interface TracerRun {
  readonly counts: Readonly<Record<string, number>>;
  readonly workerThreads: number;
  readonly collections: readonly (readonly number[])[];
}

function argumentValue(text: string): number {
  return Number(BigInt(text));
}

/** perf versions differ in whether they propagate the workload's status. */
export function assertPerfRecordStatus(
  status: number | null,
  log: string,
): void {
  assert.ok(
    status === 0 || status === FIXTURE_EXIT_CODE,
    `perf record exited with status ${status}\n${log}`,
  );
}

/** perf probe + perf record + perf script. */
function tracePerf(
  image: string,
  names: readonly string[],
  output: string,
): TracerRun {
  const data = join(output, "perf.data");
  // perf probe resolves %sdt_ events through the build-id cache (root's,
  // as perf runs as root); the probes and the cache entry are removed
  // afterwards.
  const removeProbes = (): void => {
    run("perf", ["probe", "-q", "-d", "sdt_tint:*"], true);
  };
  removeProbes();
  try {
    let log = succeed("perf", ["buildid-cache", "--add", image], true);
    for (const name of names)
      log += succeed(
        "perf",
        ["probe", "-x", image, "-a", "%sdt_" + PROVIDER + ":" + name],
        true,
      );
    const args = [
      "record",
      "-e",
      "sdt_" + PROVIDER + ":*",
      "-o",
      data,
      "--",
      image,
    ];
    const recording = run("perf", args, true);
    log += recording.stdout + recording.stderr;
    writeFileSync(join(output, "perf-record.txt"), log);
    assertPerfRecordStatus(recording.status, `perf ${args.join(" ")}\n${log}`);
  } finally {
    removeProbes();
    run("perf", ["buildid-cache", "--remove", image], true);
  }
  const script = succeed(
    "perf",
    ["script", "-i", data, "-F", "tid,event,trace"],
    true,
  );
  writeFileSync(join(output, "perf-script.txt"), script);
  return perfProbeHits(script);
}

/** Probe hits in `perf script -F tid,event,trace` output: one line per hit,
 * `<tid> sdt_tint:<name>: (<address>) arg1=<value> ...`. */
export function perfProbeHits(script: string): TracerRun {
  const counts: Record<string, number> = {};
  const workers = new Set<string>();
  const collections: number[][] = [];
  for (const line of script.split("\n")) {
    const match = /^\s*(\d+)\s+sdt_tint:(\w+):(.*)$/.exec(line);
    if (match === null) continue;
    const [, tid = "", name = "", trace = ""] = match;
    counts[name] = (counts[name] ?? 0) + 1;
    if (name === "gc_worker__begin") workers.add(tid);
    if (name === "gc__end") {
      const values = [...trace.matchAll(/arg(\d+)=(\S+)/g)]
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .map((entry) => argumentValue(entry[2] ?? "0"));
      collections.push(values.slice(0, 4));
    }
  }
  return { counts, workerThreads: workers.size, collections };
}

/** bpftrace on every probe of the provider. */
function traceBpftrace(image: string, output: string): TracerRun {
  const program = [
    `usdt:${image}:${PROVIDER}:* { @counts[probe] = count(); }`,
    `usdt:${image}:${PROVIDER}:gc_worker__begin { @workers[tid] = count(); }`,
    `usdt:${image}:${PROVIDER}:gc__end { printf("GCEND %lu %lu %lu %lu\\n", arg0, arg1, arg2, arg3); }`,
  ].join("\n");
  writeFileSync(join(output, "probes.bt"), program + "\n");
  const text = succeed(
    "bpftrace",
    ["-f", "json", "-e", program, "-c", image],
    true,
  );
  writeFileSync(join(output, "bpftrace.jsonl"), text);
  return bpftraceProbeHits(text);
}

/** Probe hits in `bpftrace -f json` output of the program above: printf
 * records of gc__end's arguments, then the @counts and @workers maps. */
export function bpftraceProbeHits(text: string): TracerRun {
  const counts: Record<string, number> = {};
  let workerThreads = 0;
  const collections: number[][] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    const record = JSON.parse(line) as {
      type: string;
      data: unknown;
    };
    if (record.type === "printf") {
      const match = /^GCEND (\d+) (\d+) (\d+) (\d+)/.exec(String(record.data));
      if (match !== null) collections.push(match.slice(1).map(Number));
    } else if (record.type === "map") {
      const maps = record.data as Record<string, Record<string, number>>;
      for (const [probe, count] of Object.entries(maps["@counts"] ?? {}))
        counts[probe.slice(probe.lastIndexOf(":") + 1)] = count;
      if (maps["@workers"] !== undefined)
        workerThreads = Object.keys(maps["@workers"]).length;
    }
  }
  return { counts, workerThreads, collections };
}

/** A tracer's counts against GDB's: every probe equal, gc.worker edges
 * balanced across several threads, gc__end metrics equal in order. */
export function compareWithGdb(
  tool: string,
  traced: TracerRun,
  reference: ProbeRun,
): void {
  const probes = new Set([
    ...Object.keys(reference.probes),
    ...Object.keys(traced.counts),
  ]);
  for (const name of probes) {
    const seen = traced.counts[name] ?? 0,
      expected = reference.probes[name]?.count ?? 0;
    if (name.startsWith("gc_worker__")) continue;
    assert.equal(seen, expected, `${tool}: ${name} hits`);
  }
  const begins = traced.counts["gc_worker__begin"] ?? 0;
  assert.ok(begins > 0, `${tool}: gc.worker probes`);
  assert.equal(
    traced.counts["gc_worker__end"],
    begins,
    `${tool}: gc.worker edges`,
  );
  assert.ok(traced.workerThreads > 1, `${tool}: workers on their own threads`);
  assert.deepEqual(
    traced.collections,
    reference.collections.map((entry) => entry.slice(0, 4)),
    `${tool}: gc__end metrics`,
  );
}

function main(): number {
  const args = process.argv.slice(2);
  const imageAt = args.indexOf("--image");
  const given = imageAt >= 0 ? args.splice(imageAt, 2)[1] : undefined;
  const staticOnly = args.includes("--static-only");
  const output = args.find((arg) => !arg.startsWith("--"));
  if (output === undefined || process.platform !== "linux") {
    console.error(
      "usage (Linux): node tools/linux/verify-usdt-live.ts <new-output-directory> [--image <image>] [--static-only]",
    );
    return 2;
  }
  mkdirSync(output);
  // A local copy: uprobes attach to the inode, and shared or network
  // mounts are not always supported.
  const local = mkdtempSync(join(tmpdir(), "tint-usdt-"));
  try {
    let source = given;
    if (source === undefined) {
      process.env.TINT_BUILD_ONLY = "1";
      source = buildSignpostFixture("usdt-live");
    }
    const image = join(local, "usdt-live");
    copyFileSync(source, image);
    const summary: Record<string, unknown> = { image: resolve(source) };
    const statics = verifyStatic(image, output);
    summary.static = {
      buildId: statics.buildId,
      probes: statics.probes.length,
      names: statics.names,
    };
    console.log(
      `static: ${statics.probes.length} tint probes; notes, readelf, perf list sdt and bpftrace -l agree`,
    );
    const finish = (status: number): number => {
      summary.status = status;
      writeFileSync(
        join(output, "summary.json"),
        JSON.stringify(summary, null, 2) + "\n",
      );
      return status;
    };
    if (staticOnly) return finish(0);
    const reason = liveUnavailable();
    if (reason !== undefined) {
      summary.live = { skipped: reason };
      console.log("live: skipped: " + reason);
      return finish(SKIPPED);
    }
    const reference = recordProbesUnderGdb(image);
    writeFileSync(join(output, "gdb.txt"), reference.session);
    assert.equal(
      reference.exitCode,
      FIXTURE_EXIT_CODE,
      "fixture exit under GDB",
    );
    assertProbeRun(reference);
    console.log(
      `gdb: ${reference.collections.length} collections, ${Object.keys(reference.probes).length} probes hit`,
    );
    const perf = tracePerf(image, statics.names, output);
    compareWithGdb("perf", perf, reference);
    console.log(
      `perf: counts and gc__end metrics match GDB (${perf.workerThreads} worker threads)`,
    );
    const bpftrace = traceBpftrace(image, output);
    compareWithGdb("bpftrace", bpftrace, reference);
    console.log(
      `bpftrace: counts and gc__end metrics match GDB (${bpftrace.workerThreads} worker threads)`,
    );
    summary.live = {
      gdb: {
        probes: reference.probes,
        collections: reference.collections.length,
      },
      perf: { counts: perf.counts, workerThreads: perf.workerThreads },
      bpftrace: {
        counts: bpftrace.counts,
        workerThreads: bpftrace.workerThreads,
      },
    };
    console.log("Verified live USDT tracing with perf and bpftrace.");
    return finish(0);
  } finally {
    rmSync(local, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
