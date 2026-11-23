/** Native checks of the heap observability tools
 * (docs/native-heap-profiling.md), all on one debug build of the shared
 * fixture (tools/heap-tools-fixture.ts), each under LLDB (tools/lldb/tint.py,
 * the default) or GDB (tools/gdb/tint.py, `--debugger gdb`), the two
 * adapters of the debugger-neutral tools/debugger/tint_heap.py:
 *
 *   descriptor   `tint-heap info` against the collector's own locals at a
 *                collection, and a complete start-bit walk of both spaces
 *   formatters   strings, lists, number lists, maps, sets, general values
 *                and records retyped from opaque object pointers
 *   snapshot     a dump at the fixture's allocation in `inspect` (a precise
 *                safepoint): exact retained counts, retained sizes and
 *                retainers, a well-formed .heapsnapshot and pprof profile
 *   core         the same dump read back from a core file (`process
 *                save-core`, `gcore`)
 *   allocations  a sampled allocation profile attributing the fixture's
 *                allocation volume to its known allocation site
 *   large        large strings and typed arrays in the large-object space:
 *                found through the descriptor's chunk table, walked and
 *                dumped into the snapshot graph
 *   collect      a forced major collection at an allocation safepoint
 *                (`collect-begin`/`collect-end`, the DevTools bridge's
 *                collectGarbage): the nursery empties, the heap walks
 *                cleanly and the program still exits 42
 *   unarmed      without a tool the image still exits 42
 *
 *   node tools/verify-heap-tools.ts [--debugger lldb|gdb] [section...]
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildHeapToolsFixture,
  inspectLine,
  retainedNodes,
} from "./heap-tools-fixture.ts";
import { allocationProfile, convert } from "./heap-snapshot/cli.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { heapDebugger } from "./heap-snapshot/debuggers.ts";
import { HeapDump } from "./heap-snapshot/dump.ts";
import { buildGraph, reportTotals } from "./heap-snapshot/graph.ts";
import { analyze, report } from "./profiling/analysis.ts";
import { writeHeapSnapshot } from "./profiling/heapsnapshot.ts";

/** A `{value, next}` chain node: the one-word header and two words. */
const nodeBytes = 24;
const argv = process.argv.slice(2);
const debuggerAt = argv.indexOf("--debugger");
const debug = heapDebugger(
  debuggerAt >= 0 ? argv.splice(debuggerAt, 2)[1] : undefined,
);
const wanted = new Set(argv);
const run = (section: string): boolean =>
  wanted.size === 0 || wanted.has(section);
process.env.TINT_DEBUG_SYMBOLS = "1";
process.env.TINT_BUILD_ONLY = "1";
const image = buildHeapToolsFixture("heap-tools");
const work = mkdtempSync(join(tmpdir(), "tint-heap-tools-"));
/** The makeChain loop: its first stop is the retained chain's construction
 * in `run`, with allocations still to come. */
const chainLine = 13;

/** The JSON after `marker` on its occurrence-th line (0-based). */
function markedJson(output: string, marker: string, occurrence = 0): unknown {
  const line = output.split("\n").filter((text) => text.startsWith(marker))[
    occurrence
  ];
  assert.ok(line !== undefined, marker + "\n" + output);
  return JSON.parse(line.slice(marker.length));
}

/** The JSON lines starting with prefix (`tint-heap ... --json` output). */
function jsonLines(output: string, prefix: string): unknown[] {
  return output
    .split("\n")
    .filter((text) => text.startsWith(prefix))
    .map((text) => JSON.parse(text) as unknown);
}

/** Prints the expression's value as JSON after a marker. */
function printJson(marker: string, expression: string): string {
  return debug.python(
    "import json; print('" + marker + " ' + json.dumps(" + expression + "))",
  );
}

/** Asserts the innermost frame is at the symbol's first instruction. */
function assertAtSymbol(name: string): string {
  return debug.python(
    "assert " +
      debug.pcExpression +
      " == " +
      debug.symbolExpression(name) +
      ", " +
      debug.functionExpression,
  );
}

/** Breakpoint at the fixture allocation in `inspect`, then the sample hook. */
function stopInInspect(): string[] {
  return [
    debug.breakAtLine("fixture", inspectLine),
    debug.launch,
    debug.python("assert " + debug.stoppedExpression),
    debug.deleteBreakpoints,
    "tint-heap arm 1",
    debug.breakAtSymbol("__tint_allocation_sample"),
    debug.resume,
    assertAtSymbol("__tint_allocation_sample"),
  ];
}

try {
  if (run("descriptor")) {
    // A line inside the collector where youngTop and oldTop are live (one
    // with its own line-table entry), found rather than hard-coded.
    const collectLine =
      readFileSync("packages/native-runtime/src/generational.ts", "utf8")
        .split("\n")
        .findIndex((line) => line.trim() === "if (minor) {") + 1;
    assert.ok(collectLine > 0, "collector line");
    const inCollect = debug.python(
      "assert 'native-runtime/src/generational.ts:collect ' in " +
        debug.functionExpression +
        ", " +
        debug.functionExpression,
    );
    const locals = printJson(
      "LOCALS",
      "{'youngTop': " +
        debug.localNumberExpression("youngTop") +
        ", 'oldTop': " +
        debug.localNumberExpression("oldTop") +
        "}",
    );
    const output = debug.run(image, [
      debug.breakAtLine(
        "packages/native-runtime/src/generational.ts",
        collectLine,
      ),
      ...(debug.name === "lldb"
        ? [
            // The line must resolve inside the collector function (found
            // by its symbol), never silently into a neighbour after an
            // edit. (Under GDB each stop's frame is checked instead.)
            "script bp = lldb.target.GetBreakpointAtIndex(0); names = [bp.GetLocationAtIndex(i).GetAddress().GetFunction().GetName() or '' for i in range(bp.GetNumLocations())]; assert len(names) == 1 and 'native-runtime/src/generational.ts:collect ' in names[0], names",
          ]
        : []),
      debug.launch,
      inCollect,
      locals,
      "tint-heap info --json",
      "tint-heap verify --json",
      debug.resume,
      debug.resume,
      inCollect,
      locals,
      "tint-heap info --json",
      "tint-heap verify --json",
      debug.deleteBreakpoints,
      debug.resume,
      debug.assertExit(42),
    ]);
    const descriptors = jsonLines(output, '{"descriptor"'),
      walks = jsonLines(output, '{"old"');
    assert.equal(descriptors.length, 2, output);
    assert.equal(walks.length, 2, output);
    for (const occurrence of [0, 1]) {
      const seen = markedJson(output, "LOCALS ", occurrence) as {
        youngTop: number;
        oldTop: number;
      };
      const descriptor = descriptors[occurrence] as {
        state: { youngTop: number; oldTop: number; youngCapacity: number };
      };
      assert.equal(descriptor.state.youngTop, seen.youngTop, "young top");
      assert.equal(descriptor.state.oldTop, seen.oldTop, "old top");
      const walk = walks[occurrence] as Record<
        string,
        { objects: number; bytes: number; top?: number }
      >;
      // Small collections are serial and leave no gaps: the start bits
      // cover every allocated byte of both spaces.
      assert.equal(walk.old?.bytes, seen.oldTop, "old walk");
      assert.equal(walk.young?.bytes, seen.youngTop, "young walk");
      assert.ok((walk.young?.objects ?? 0) > 1000);
    }
    const first = descriptors[0] as {
      version: number;
      headerBytes: number;
      granule: number;
    };
    assert.deepEqual(
      [first.version, first.headerBytes, first.granule],
      [3, 8, 8],
    );
    console.log("descriptor: state and start-bit walks match the collector");
  }

  if (run("large")) {
    // Strings and typed arrays of at least the data threshold live in the
    // large-object space: the descriptor's chunk table finds them, the
    // walk checks them and the dump carries them into the snapshot graph.
    const largeLine = 6;
    const largeImage = verifyHostedFixture(
      `export function run(): number {
  const bytes = new Uint8Array(400000);
  bytes[1] = 7;
  let text = "ab";
  while (text.length < 200000) text = text + text;
  const sizes: number[] = [bytes.length, text.length];
  return (sizes[0] ?? 0) > 0 && bytes[1] === 7 ? 42 : 1;
}
`,
      "heap-tools-large",
      [],
      [],
      [],
      [],
      {
        managedBytes: 16777216,
        allocationCapacity: 1048576,
        runtimeEntry: "initializeGenerationalRuntime",
      },
    );
    const largeDump = join(work, "large");
    // The walk runs at the line; the dump needs a precise safepoint, the
    // next allocation's sample hook (whose object is not yet initialized).
    const output = debug.run(largeImage, [
      debug.breakAtLine("fixture", largeLine),
      debug.launch,
      debug.python("assert " + debug.stoppedExpression),
      "tint-heap info --json",
      "tint-heap verify --json",
      debug.deleteBreakpoints,
      "tint-heap arm 1",
      debug.breakAtSymbol("__tint_allocation_sample"),
      debug.resume,
      assertAtSymbol("__tint_allocation_sample"),
      "tint-heap dump " + largeDump,
      debug.deleteBreakpoints,
      debug.resume,
      debug.assertExit(42),
    ]);
    const info = jsonLines(output, '{"descriptor"')[0] as {
      state: { largeCount: number; largeGranule: number };
    };
    assert.equal(info.state.largeGranule, 65536, output);
    // The array and every doubled string from 262,144 units up.
    assert.ok(info.state.largeCount >= 2, output);
    const walk = jsonLines(output, '{"old"')[0] as Record<
      string,
      { objects: number; kinds: Record<string, [number, number]> }
    >;
    assert.equal(walk.large?.objects, info.state.largeCount, output);
    assert.ok((walk.large?.kinds.Uint8Array?.[0] ?? 0) >= 1, output);
    assert.ok((walk.large?.kinds.string?.[0] ?? 0) >= 1, output);
    const dump = new HeapDump(largeDump),
      graph = buildGraph(dump);
    assert.equal(dump.large.length, info.state.largeCount);
    const largest = Math.max(
      ...dump.large.map((region) => region.bytes.length),
    );
    assert.ok(largest >= 400000, "the typed array's chunk was dumped");
    assert.equal(graph.stats.rootWalk, "complete");
    console.log(
      `large: ${info.state.largeCount} large objects walked and dumped`,
    );
  }

  if (run("formatters")) {
    const show =
      debug.name === "lldb"
        ? [
            "frame variable *holder",
            "frame variable -P 3 holder->items",
            "frame variable -P 1 holder->names holder->numbers holder->tags",
            "frame variable -P 2 holder->index",
          ]
        : [
            "print *holder",
            "print -max-depth 3 -- holder->items",
            "print -max-depth 1 -- holder->names",
            "print -max-depth 1 -- holder->numbers",
            "print -max-depth 1 -- holder->tags",
            "print -max-depth 2 -- holder->index",
          ];
    const output = debug.run(image, [
      debug.breakAtLine("fixture", inspectLine),
      debug.launch,
      ...show,
      debug.kill,
    ]);
    const expectations: [string, RegExp][] = [
      ["record pointer fields retyped", /items = 0x[0-9a-f]+ \{length, root\}/],
      [
        "map retyped",
        /index = 0x[0-9a-f]+ \{keys, buckets, head, tail, size, order\}/,
      ],
      ["general string", /anything = "dynamic"/],
      // GDB separates a printer's summary from its children with " = ".
      ["list elements", /\[0\] = 0x[0-9a-f]+ \{x, y, label\} (= )?\{/],
      ["nested string", /label = 0x[0-9a-f]+ "p2"/],
      ["string list", /\[1\] = 0x[0-9a-f]+ "beta"/],
      ["number list", /\[2\] = 3\.5/],
      ["set entries", /\[1\] = 0x[0-9a-f]+ "green"/],
      ["map entries", /\["second"\] = 0x[0-9a-f]+ \{x, y, label\}/],
    ];
    for (const [name, pattern] of expectations)
      assert.match(output, pattern, name + "\n" + output);
    console.log("formatters: strings, lists, maps, sets and generals");
  }

  const dumpDirectory = join(work, "inspect");
  if (run("snapshot") || run("core")) {
    const core = join(work, "inspect.core");
    debug.run(image, [
      ...stopInInspect(),
      "tint-heap dump " + dumpDirectory,
      ...(run("core") ? [debug.saveCore(core)] : []),
      debug.kill,
    ]);
    const dump = new HeapDump(dumpDirectory),
      graph = buildGraph(dump),
      analysis = analyze(graph),
      summary = report(analysis, "inspect", 40, reportTotals(graph));
    const nodes = summary.types.find((type) => type.name === "{value, next}");
    assert.equal(nodes?.objects, retainedNodes, "reachable chain nodes");
    assert.equal(
      nodes?.retained,
      retainedNodes * nodeBytes,
      "chain retained size",
    );
    const points = summary.types.find((type) => type.name === "{x, y, label}");
    assert.equal(points?.objects, 3, "list elements before the push");
    const holder = summary.types.find((type) =>
      type.name.startsWith("{items, names"),
    );
    assert.equal(holder?.objects, 1);
    const head = summary.dominators[0];
    assert.equal(head?.type, "{value, next}");
    assert.equal(head?.retained, retainedNodes * nodeBytes);
    // Both inspect's and run's frames hold the chain head.
    assert.deepEqual(head?.path, ["(root)"]);
    const frameNames = summary.frames.map((frame) => frame.name).join("\n");
    assert.match(frameNames, /^program:fixture:inspect /m);
    assert.match(frameNames, /^program:fixture:run /m);
    assert.equal(summary.totals.headerBytes, 8 * summary.totals.objects);
    assert.equal(graph.stats.rootWalk, "complete");
    // The allocation the hook reports is not yet initialized: skipped, not
    // decoded from whatever bytes the nursery held before.
    assert.ok(dump.meta.pending != null && dump.meta.pending.size > 0);
    assert.equal(
      graph.stats.pendingBytes,
      Math.ceil(dump.meta.pending.size / 8) * 8,
    );
    // A well-formed V8 snapshot: field counts, edge targets, strings.
    const file = join(work, "inspect.heapsnapshot");
    const totals = writeHeapSnapshot(analysis, file);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      snapshot: {
        meta: { node_fields: string[]; edge_fields: string[] };
        node_count: number;
        edge_count: number;
      };
      nodes: number[];
      edges: number[];
      strings: string[];
    };
    const nodeFields = parsed.snapshot.meta.node_fields.length,
      edgeFields = parsed.snapshot.meta.edge_fields.length;
    assert.equal(nodeFields, 7);
    assert.equal(parsed.nodes.length, parsed.snapshot.node_count * nodeFields);
    assert.equal(parsed.edges.length, parsed.snapshot.edge_count * edgeFields);
    assert.equal(parsed.snapshot.node_count, totals.nodes);
    let edgeSum = 0;
    const ids = new Set<number>();
    for (let at = 0; at < parsed.nodes.length; at += nodeFields) {
      edgeSum += parsed.nodes[at + 4] ?? 0;
      assert.ok((parsed.nodes[at + 1] ?? -1) < parsed.strings.length);
      ids.add(parsed.nodes[at + 2] ?? 0);
    }
    assert.equal(ids.size, parsed.snapshot.node_count, "unique node ids");
    assert.equal(edgeSum, parsed.snapshot.edge_count);
    for (let at = 0; at < parsed.edges.length; at += edgeFields) {
      const to = parsed.edges[at + 2] ?? -1;
      assert.ok(to % nodeFields === 0 && to < parsed.nodes.length);
    }
    assert.equal(parsed.strings[parsed.nodes[1] ?? 0], "");
    // Heap strings are named by their text (literals live in the image).
    assert.ok(parsed.strings.includes("p2") && parsed.strings.includes("p0"));
    // pprof in-use profile through the CLI.
    const profile = join(work, "inspect.pb.gz");
    convert([dumpDirectory, "--pprof", profile]);
    assert.ok(gunzipSync(readFileSync(profile)).length > 0);
    const pprof = spawnSync("go", ["tool", "pprof", "-top", profile], {
      encoding: "utf8",
    });
    if (pprof.error === undefined) {
      assert.equal(pprof.status, 0, pprof.stderr);
      assert.match(pprof.stdout, /Type: inuse_space/);
      assert.match(pprof.stdout, /\{value, next\}/);
    }
    console.log(
      `snapshot: ${summary.totals.reachableObjects} reachable objects, chain retained ${nodes?.retained} bytes`,
    );
    if (run("core")) {
      assert.ok(existsSync(core) && statSync(core).size > 0);
      const fromCore = join(work, "core-dump");
      debug.run(
        image,
        ["tint-heap dump " + fromCore],
        debug.coreArguments(core),
      );
      const coreGraph = buildGraph(new HeapDump(fromCore));
      const coreSummary = report(
        analyze(coreGraph),
        "core",
        40,
        reportTotals(coreGraph),
      );
      assert.deepEqual(coreSummary.totals, summary.totals, "core = live");
      assert.deepEqual(coreSummary.types, summary.types);
      rmSync(core, { force: true });
      console.log("core: the saved core dumps the same heap");
    }
  }

  if (run("allocations")) {
    const samples = join(work, "allocations.jsonl");
    const output = debug.run(image, [
      debug.launchAtEntry(),
      "tint-heap sample --interval 16384 --seed 7 --out " + samples,
    ]);
    assert.match(output, /TINTHEAP samples=\d+ exit=42 /);
    const result = allocationProfile(samples);
    // churn: 300 lists of 2000 nodes; the retained chain: 5000 nodes.
    const expected = (300 * 2000 + retainedNodes) * nodeBytes;
    assert.ok(
      Math.abs(result.bytes - expected) < expected * 0.1,
      `estimated ${result.bytes} vs ${expected}`,
    );
    let chain = 0,
      total = 0,
      typed = 0;
    for (const line of readFileSync(samples, "utf8").split("\n").slice(1)) {
      if (line === "") continue;
      const record = JSON.parse(line) as {
        stack: { lines: { function: string }[] }[];
        type: string | null;
      };
      total++;
      if (/makeChain/.test(record.stack[0]?.lines[0]?.function ?? "")) chain++;
      if (record.type === "{value, next}") typed++;
    }
    assert.ok(chain > total * 0.98, `${chain} of ${total} at makeChain`);
    assert.ok(typed > total * 0.95, `${typed} of ${total} typed`);
    console.log(
      `allocations: ${total} samples, ~${(result.bytes / 1048576).toFixed(1)} MiB (expected ${(expected / 1048576).toFixed(1)})`,
    );
  }

  if (run("collect")) {
    // Inside makeChain (the retained chain under construction), the next
    // allocation's slow-path thunk entry is a safepoint; a forced major
    // collection there must keep the partial chain and every caller's
    // roots.
    const output = debug.run(image, [
      debug.breakAtLine("fixture", chainLine),
      debug.launch,
      debug.deleteBreakpoints,
      "tint-heap arm 1",
      debug.breakAtSymbol("__tint_allocation_sample_thunk"),
      debug.resume,
      assertAtSymbol("__tint_allocation_sample_thunk"),
      "tint-heap collect-begin",
      debug.resume,
      "tint-heap collect-end",
      "tint-heap verify --json",
      debug.deleteBreakpoints,
      "tint-heap arm 0",
      debug.resume,
      debug.assertExit(42),
    ]);
    const collected =
      /TINTHEAP collected status=(\d+) old=(\d+)->(\d+) young=(\d+)->(\d+)/.exec(
        output,
      );
    assert.ok(collected !== null, output);
    const [, status, , oldAfter, youngBefore, youngAfter] =
      collected.map(Number);
    assert.equal(status, 1, "the forced collection succeeded");
    assert.ok((youngBefore ?? 0) > 0, "a nursery to collect");
    assert.equal(youngAfter, 0, "a major collection empties the nursery");
    const [walk] = jsonLines(output, '{"old"') as Record<
      string,
      { objects: number; bytes: number }
    >[];
    assert.equal(walk?.old?.bytes, oldAfter, "the old space walks cleanly");
    assert.equal(walk?.young?.objects, 0);
    console.log(
      `collect: forced major at a safepoint, nursery ${youngBefore} -> 0 bytes, old ${oldAfter} bytes`,
    );
  }

  if (run("unarmed")) {
    const output = debug.run(image, [debug.launch, debug.assertExit(42)]);
    assert.match(output, /exited with (status = 42 |code 052)/);
    console.log("unarmed: exits 42");
  }
} finally {
  if (process.env.TINT_KEEP_NATIVE !== "1") {
    rmSync(work, { recursive: true, force: true });
    rmSync(dirname(image), { recursive: true, force: true });
  } else console.log("kept " + work + " and " + image);
}
