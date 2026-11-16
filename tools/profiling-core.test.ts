// The shared profiling core (tools/profiling): pprof round trips, the call
// tree with inlined frames, the DevTools .cpuprofile/.heapprofile writers,
// and heap snapshots of a producer-neutral graph.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyze, report } from "./profiling/analysis.ts";
import {
  fromCpuProfile,
  toCpuProfile,
  toSamplingHeapProfile,
} from "./profiling/devtools-profiles.ts";
import {
  edgeElement,
  edgeProperty,
  edgeWeak,
  type HeapGraph,
} from "./profiling/heap-graph.ts";
import { allocationSamples, inUseSamples } from "./profiling/heap-profiles.ts";
import { writeHeapSnapshot, type TextSink } from "./profiling/heapsnapshot.ts";
import { decodeProfile, encodeProfile } from "./profiling/pprof.ts";
import {
  buildCallTree,
  symbolised,
  type SampleProfile,
} from "./profiling/samples.ts";

// main -> spin (physical) with weight inlined into spin at the leaf.
const leaf = {
  address: 0x100000534,
  lines: [
    { function: "weight", file: "/src/prog.c", line: 4, column: 35 },
    {
      function: "spin",
      file: "/src/prog.c",
      line: 7,
      column: 51,
      startLine: 5,
    },
  ],
};
const caller = {
  address: 0x1000005fc,
  lines: [
    {
      function: "main",
      file: "/src/prog.c",
      line: 17,
      column: 43,
      startLine: 10,
    },
  ],
};
const cpu: SampleProfile = {
  sampleTypes: [
    { type: "samples", unit: "count" },
    { type: "wall", unit: "nanoseconds" },
  ],
  periodType: { type: "wall", unit: "nanoseconds" },
  period: 10_000_000,
  samples: [
    {
      stack: [leaf, caller],
      values: [1, 10_000_000],
      numLabels: { "pprofessor::timestamp": 2_000_000_000 },
    },
    {
      stack: [caller],
      values: [1, 10_000_000],
      numLabels: { "pprofessor::timestamp": 1_000_000_000 },
    },
    {
      stack: [leaf, caller],
      values: [2, 20_000_000],
      numLabels: { "pprofessor::timestamp": 3_000_000_000 },
    },
  ],
  mappings: [
    {
      start: 0x100000000,
      limit: 0x100004000,
      offset: 0,
      file: "/src/prog",
      buildId: "1D4C",
    },
  ],
  timeNanos: 1_000_000_000,
};

test("pprof encode and decode round-trip the sample model", () => {
  const decoded = decodeProfile(encodeProfile(cpu));
  assert.deepEqual(decoded.sampleTypes, cpu.sampleTypes);
  assert.equal(decoded.samples.length, 3);
  const first = decoded.samples[0];
  assert.deepEqual(first?.values, [1, 10_000_000]);
  assert.deepEqual(first?.numLabels, { "pprofessor::timestamp": 2e9 });
  assert.equal(first?.stack[0]?.address, 0x100000534);
  assert.deepEqual(
    first?.stack[0]?.lines.map((line) => [line.function, line.line]),
    [
      ["weight", 4],
      ["spin", 7],
    ],
  );
  assert.equal(first?.stack[0]?.lines[0]?.column, 35);
  assert.equal(first?.stack[0]?.lines[1]?.startLine, 5);
  assert.equal(first?.stack[0]?.lines[0]?.file, "/src/prog.c");
  assert.deepEqual(decoded.mappings, cpu.mappings);
  assert.equal(decoded.period, 10_000_000);
  assert.equal(decoded.timeNanos, 1_000_000_000);
  // String labels and negative int64 values survive.
  const labelled = decodeProfile(
    encodeProfile({
      sampleTypes: [{ type: "x", unit: "count" }],
      samples: [
        { stack: [caller], values: [-3], labels: { type: "{value, next}" } },
      ],
    }),
  );
  assert.deepEqual(labelled.samples[0]?.values, [-3]);
  assert.deepEqual(labelled.samples[0]?.labels, { type: "{value, next}" });
});

test("call trees expand inlined lines into frames, root first", () => {
  const tree = buildCallTree(cpu);
  const main = tree.root.children[0];
  assert.equal(main?.function, "main");
  assert.equal(main?.line, 10, "start line when known");
  const spin = main?.children[0];
  assert.equal(spin?.function, "spin");
  const weight = spin?.children[0];
  assert.equal(weight?.function, "weight");
  assert.equal(weight?.line, 4, "first line seen without a start line");
  assert.deepEqual(weight?.self, [3, 30_000_000]);
  assert.deepEqual(main?.self, [1, 10_000_000]);
  assert.equal(tree.leaves[1], main);
  assert.deepEqual([...(weight?.lines ?? [])], [[4, 3]]);
});

test(".cpuprofile: consistent nodes, time-ordered samples and ticks", () => {
  const profile = toCpuProfile(cpu, {
    scriptIdOf: (file) => (file === "/src/prog.c" ? "7" : undefined),
  });
  const ids = new Set(profile.nodes.map((node) => node.id));
  assert.equal(ids.size, profile.nodes.length);
  for (const node of profile.nodes)
    for (const child of node.children ?? []) assert.ok(ids.has(child));
  assert.equal(profile.nodes[0]?.callFrame.functionName, "(root)");
  // Four ticks (the last sample counts 2), sorted by timestamp.
  assert.equal(profile.samples.length, 4);
  assert.equal(profile.timeDeltas.length, 4);
  assert.equal(profile.startTime, 1_000_000);
  assert.deepEqual(profile.timeDeltas.slice(0, 3), [0, 1_000_000, 1_000_000]);
  const main = profile.nodes.find(
    (node) => node.callFrame.functionName === "main",
  );
  assert.equal(profile.samples[0], main?.id, "the earliest sample first");
  assert.equal(main?.callFrame.lineNumber, 9, "0-based");
  assert.equal(main?.callFrame.scriptId, "7");
  assert.equal(main?.callFrame.url, "file:///src/prog.c");
  const weight = profile.nodes.find(
    (node) => node.callFrame.functionName === "weight",
  );
  assert.equal(weight?.hitCount, 3);
  assert.deepEqual(weight?.positionTicks, [{ line: 4, ticks: 3 }]);
  const total = profile.nodes.reduce((sum, node) => sum + node.hitCount, 0);
  assert.equal(total, profile.samples.length);
  assert.ok(profile.endTime >= profile.startTime);
  // And back to the model.
  const back = fromCpuProfile(profile);
  assert.equal(back.samples.length, 4);
  assert.deepEqual(
    back.samples[3]?.stack.map((location) => location.lines[0]?.function),
    ["weight", "spin", "main"],
  );
});

test(".heapprofile: self sizes are estimated bytes per allocation site", () => {
  const { profile, bytes } = allocationSamples(
    {
      interval: 1024,
      image: { path: "/src/prog", loadAddress: 0x100000000, uuid: "U" },
    },
    [
      {
        address: 0x1000,
        size: 24,
        young: true,
        type: "{value, next}",
        stack: [
          {
            pc: 0x100000534,
            lines: [
              { function: "makeChain", file: "fixture", line: 13 },
              { function: "churn", file: "fixture", line: 19 },
            ],
          },
          {
            pc: 0x1000005fc,
            lines: [{ function: "run", file: null, line: 0 }],
          },
        ],
      },
      {
        address: 0x2000,
        size: 4096,
        young: false,
        type: "vector",
        stack: [
          {
            pc: 0x1000005fc,
            lines: [{ function: "run", file: null, line: 0 }],
          },
        ],
      },
    ],
  );
  const weight = 1 / (1 - Math.exp(-24 / 1024));
  assert.ok(Math.abs(bytes - (weight * 24 + 4096)) < 1e-6);
  const heap = toSamplingHeapProfile(profile);
  const run = heap.head.children[0];
  assert.equal(run?.callFrame.functionName, "run");
  assert.equal(run?.selfSize, 4096);
  const churn = run?.children[0],
    make = churn?.children[0];
  assert.equal(churn?.callFrame.functionName, "churn");
  assert.equal(make?.callFrame.functionName, "makeChain");
  assert.equal(make?.callFrame.lineNumber, 12);
  assert.equal(make?.selfSize, Math.round(weight * 24));
  assert.deepEqual(
    heap.samples.map((sample) => [sample.size, sample.ordinal]),
    [
      [24, 1],
      [4096, 2],
    ],
  );
  assert.equal(heap.samples[0]?.nodeId, make?.id);
  // pprof keeps the labels.
  const decoded = decodeProfile(encodeProfile(profile));
  assert.equal(decoded.samples[0]?.labels?.type, "{value, next}");
});

/** A producer-neutral graph (as a generic native producer would build):
 * one frame holding a list whose elements share a string, plus a weak
 * reference to an otherwise unreachable object. */
function neutralGraph(): HeapGraph {
  // Objects: 0 list, 1 a, 2 b, 3 text, 4 weakly held, 5 garbage.
  const edges: [number, number, number, number][] = [
    [0, 1, edgeElement, 0],
    [0, 2, edgeElement, 1],
    [1, 3, edgeProperty, 0],
    [2, 3, edgeProperty, 0],
    [2, 4, edgeWeak, 1],
  ];
  const edgeStart = new Uint32Array(7);
  for (const [from] of edges)
    edgeStart[from + 1] = (edgeStart[from + 1] ?? 0) + 1;
  for (let at = 0; at < 6; at++)
    edgeStart[at + 1] = (edgeStart[at + 1] ?? 0) + (edgeStart[at] ?? 0);
  return {
    count: 6,
    address: Float64Array.from([16, 48, 80, 112, 144, 176]),
    size: Uint32Array.from([32, 32, 32, 24, 16, 64]),
    type: Uint32Array.from([0, 1, 1, 2, 1, 1]),
    types: [
      { name: "Array", category: "vector" },
      { name: "Point", category: "record" },
      { name: "string", category: "string" },
    ],
    edgeStart,
    edgeTarget: Uint32Array.from(edges.map((edge) => edge[1])),
    edgeName: Uint32Array.from(edges.map((edge) => edge[3])),
    edgeType: Uint8Array.from(edges.map((edge) => edge[2])),
    names: ["label", "cache"],
    frames: [{ name: "main (prog.c:12)", fp: 0x1000, roots: [0, 0] }],
    id: (object) => object * 2 + 101,
    label: (object) => (object === 3 ? "hello" : undefined),
    timeSeconds: 1700000000,
  };
}

test("heap snapshots of a neutral graph: retained sizes and V8 format", () => {
  const graph = neutralGraph(),
    analysis = analyze(graph),
    summary = report(analysis, "neutral");
  assert.equal(summary.totals.objects, 6);
  assert.equal(summary.totals.reachableObjects, 4, "weak and garbage excluded");
  assert.equal(summary.totals.reachableBytes, 32 + 32 + 32 + 24);
  assert.equal(analysis.retained[analysis.objectBase], 120, "list retains all");
  assert.equal(summary.frames[0]?.retained, 120);
  const chunks: string[] = [];
  let closed = false;
  const sink: TextSink = {
    write: (chunk) => chunks.push(chunk),
    close: () => {
      closed = true;
    },
  };
  const totals = writeHeapSnapshot(analysis, sink);
  assert.ok(closed);
  const parsed = JSON.parse(chunks.join("")) as {
    snapshot: { node_count: number; edge_count: number };
    nodes: number[];
    edges: number[];
    strings: string[];
  };
  assert.equal(parsed.snapshot.node_count, totals.nodes);
  assert.equal(parsed.nodes.length, totals.nodes * 7);
  assert.equal(parsed.edges.length, totals.edges * 3);
  // root, (GC roots), (Stack roots), one frame, four reachable objects
  assert.equal(totals.nodes, 8);
  assert.ok(parsed.strings.includes("hello"));
  assert.ok(parsed.strings.includes("main (prog.c:12)"));
  const ids = [];
  for (let at = 0; at < parsed.nodes.length; at += 7)
    ids.push(parsed.nodes[at + 2]);
  assert.deepEqual(ids.slice(4), [101, 103, 105, 107]);
  // With unreachable objects and through a file.
  const dir = mkdtempSync(join(tmpdir(), "tint-profiling-"));
  try {
    const file = join(dir, "all.heapsnapshot");
    const all = writeHeapSnapshot(analysis, file, { includeUnreachable: true });
    assert.equal(all.objects, 6);
    const text = JSON.parse(readFileSync(file, "utf8")) as {
      snapshot: { node_count: number };
    };
    assert.equal(text.snapshot.node_count, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // In-use samples: the list's types by dominator path.
  const inUse = inUseSamples(analysis);
  const bytes = inUse.samples.reduce(
    (sum, sample) => sum + (sample.values[1] ?? 0),
    0,
  );
  assert.equal(bytes, 120);
});

test("symbolised replaces lines by address and keeps unknown ones", () => {
  const resolved = symbolised(cpu, (address) =>
    address === 0x1000005fc
      ? [{ function: "main", file: "/src/prog.c", line: 18 }]
      : undefined,
  );
  assert.equal(resolved.samples[1]?.stack[0]?.lines[0]?.line, 18);
  assert.equal(resolved.samples[0]?.stack[0]?.lines[0]?.function, "weight");
});
