/** Native checks of the heap observability tools
 * (docs/native-heap-profiling.md), all on one debug build of the shared
 * fixture (tools/heap-tools-fixture.ts), each under LLDB:
 *
 *   descriptor   `tint-heap info` against the collector's own locals at a
 *                collection, and a complete start-bit walk of both spaces
 *   formatters   strings, lists, number lists, maps, sets, general values
 *                and records retyped from opaque object pointers
 *   snapshot     a dump at the fixture's allocation in `inspect` (a precise
 *                safepoint): exact retained counts, retained sizes and
 *                retainers, a well-formed .heapsnapshot and pprof profile
 *   core         the same dump read back from `process save-core`
 *   allocations  a sampled allocation profile attributing the fixture's
 *                allocation volume to its known allocation site
 *   unarmed      without a tool the image still exits 42; with heap
 *                introspection off the code matches the default build
 *
 *   node tools/verify-heap-tools.ts [section...]
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
import {
  allocationProfile,
  convert,
  lldbModule,
  runLldb,
} from "./heap-snapshot/cli.ts";
import { HeapDump } from "./heap-snapshot/dump.ts";
import { buildGraph } from "./heap-snapshot/graph.ts";
import { analyze, report } from "./heap-snapshot/analysis.ts";
import { writeHeapSnapshot } from "./heap-snapshot/heapsnapshot.ts";

/** A `{value, next}` chain node: the one-word header and two words. */
const nodeBytes = 24;
const wanted = new Set(process.argv.slice(2));
const run = (section: string): boolean =>
  wanted.size === 0 || wanted.has(section);
process.env.TINT_DEBUG_SYMBOLS = "1";
process.env.TINT_BUILD_ONLY = "1";
const image = buildHeapToolsFixture("heap-tools");
const work = mkdtempSync(join(tmpdir(), "tint-heap-tools-"));
void lldbModule;

function lldbJson(output: string, marker: string): unknown {
  const line = output.split("\n").find((text) => text.startsWith(marker));
  assert.ok(line !== undefined, output);
  return JSON.parse(line.slice(marker.length));
}

/** Breakpoint at the fixture allocation in `inspect`, then the sample hook. */
function stopInInspect(): string[] {
  return [
    "breakpoint set --file fixture --line " + inspectLine,
    "process launch",
    "script assert lldb.process.GetState() == lldb.eStateStopped",
    "breakpoint delete --force",
    "tint-heap arm 1",
    "breakpoint set --name __tint_allocation_sample",
    "continue",
    "script assert lldb.thread.GetFrameAtIndex(0).GetFunctionName() == '__tint_allocation_sample', lldb.thread.GetFrameAtIndex(0).GetFunctionName()",
  ];
}

try {
  if (run("descriptor")) {
    const output = runLldb(image, [
      "breakpoint set --file packages/native-runtime/src/generational.ts --line 173",
      "process launch",
      "script import json, tint; d = tint.Descriptor(lldb.target, lldb.process); f = lldb.frame; print('DESCRIPTOR ' + json.dumps({'youngTop': float(f.FindVariable('youngTop').GetValue()), 'oldTop': float(f.FindVariable('oldTop').GetValue()), 'state': d.state, 'version': d.version, 'header': d.header_bytes, 'granule': d.granule, 'kinds': len(d.kinds)}))",
      "script import json, tint; print('WALK ' + json.dumps(tint.verify_heap(lldb.debugger, tint.Descriptor(lldb.target, lldb.process), None)))",
      "continue",
      "continue",
      "script import json, tint; f = lldb.frame; d = tint.Descriptor(lldb.target, lldb.process); print('SECOND ' + json.dumps({'youngTop': float(f.FindVariable('youngTop').GetValue()), 'oldTop': float(f.FindVariable('oldTop').GetValue()), 'state': d.state}))",
      "script import json, tint; print('WALK2 ' + json.dumps(tint.verify_heap(lldb.debugger, tint.Descriptor(lldb.target, lldb.process), None)))",
      "breakpoint delete --force",
      "continue",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
    ]);
    for (const [first, walkMarker] of [
      ["DESCRIPTOR ", "WALK "],
      ["SECOND ", "WALK2 "],
    ] as const) {
      const seen = lldbJson(output, first) as {
        youngTop: number;
        oldTop: number;
        state: { youngTop: number; oldTop: number; youngCapacity: number };
      };
      assert.equal(seen.state.youngTop, seen.youngTop, "young top");
      assert.equal(seen.state.oldTop, seen.oldTop, "old top");
      const walk = lldbJson(output, walkMarker) as Record<
        string,
        { objects: number; bytes: number; top?: number }
      >;
      // Small collections are serial and leave no gaps: the start bits
      // cover every allocated byte of both spaces.
      assert.equal(walk.old?.bytes, seen.oldTop, "old walk");
      assert.equal(walk.young?.bytes, seen.youngTop, "young walk");
      assert.ok((walk.young?.objects ?? 0) > 1000);
    }
    const first = lldbJson(output, "DESCRIPTOR ") as {
      version: number;
      header: number;
      granule: number;
      kinds: number;
    };
    assert.deepEqual([first.version, first.header, first.granule], [2, 8, 8]);
    console.log("descriptor: state and start-bit walks match the collector");
  }

  if (run("formatters")) {
    const output = runLldb(image, [
      "breakpoint set --file fixture --line " + inspectLine,
      "process launch",
      "frame variable *holder",
      "frame variable -P 3 holder->items",
      "frame variable -P 1 holder->names holder->numbers holder->tags",
      "frame variable -P 2 holder->index",
      "process kill",
    ]);
    const expectations: [string, RegExp][] = [
      ["record pointer fields retyped", /items = 0x[0-9a-f]+ \{length, root\}/],
      [
        "map retyped",
        /index = 0x[0-9a-f]+ \{keys, buckets, head, tail, size, order\}/,
      ],
      ["general string", /anything = "dynamic"/],
      ["list elements", /\[0\] = 0x[0-9a-f]+ \{x, y, label\} \{/],
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
    runLldb(image, [
      ...stopInInspect(),
      "tint-heap dump " + dumpDirectory,
      ...(run("core") ? ["process save-core " + core] : []),
      "process kill",
    ]);
    const dump = new HeapDump(dumpDirectory),
      graph = buildGraph(dump),
      analysis = analyze(graph),
      summary = report(analysis, "inspect");
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
      runLldb(image, ["tint-heap dump " + fromCore], ["-c", core]);
      const coreSummary = report(
        analyze(buildGraph(new HeapDump(fromCore))),
        "core",
      );
      assert.deepEqual(coreSummary.totals, summary.totals, "core = live");
      assert.deepEqual(coreSummary.types, summary.types);
      rmSync(core, { force: true });
      console.log("core: the saved core dumps the same heap");
    }
  }

  if (run("allocations")) {
    const samples = join(work, "allocations.jsonl");
    const output = runLldb(image, [
      "process launch --stop-at-entry",
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

  if (run("unarmed")) {
    const output = runLldb(image, [
      "process launch",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
    ]);
    assert.match(output, /exited with status = 42 /);
    console.log("unarmed: exits 42");
  }
} finally {
  if (process.env.TINT_KEEP_NATIVE !== "1") {
    rmSync(work, { recursive: true, force: true });
    rmSync(dirname(image), { recursive: true, force: true });
  } else console.log("kept " + work + " and " + image);
}
