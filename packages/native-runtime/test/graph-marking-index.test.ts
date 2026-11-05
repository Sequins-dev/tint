import assert from "node:assert/strict";
import { test } from "node:test";
import { markIndexedGraph, type IndexedGraph } from "../src/graph/index.ts";
function graph(edges: number[][], roots: number[]): IndexedGraph {
  return {
    nodeCount: edges.length,
    rootCount: roots.length,
    rootAt: (i) => roots[i],
    edgeCount: (n) => edges[n]?.length,
    edgeAt: (n, i) => edges[n]?.[i],
  };
}
test("bounded marking handles cycles, duplicate roots and unreachable subgraphs", () => {
  const marks = new Uint8Array(5);
  assert.equal(
    markIndexedGraph(
      graph([[1, 1], [0, 2], [], [4], [3]], [0, 0]),
      marks,
      new Uint32Array(3),
    ),
    "complete",
  );
  assert.deepEqual([...marks], [2, 2, 2, 0, 0]);
  assert.equal(
    markIndexedGraph(
      graph([[1], [0], [], [4], [3]], [3]),
      marks,
      new Uint32Array(3),
    ),
    "complete",
  );
  assert.deepEqual([...marks], [0, 0, 0, 2, 2]);
});
test("failed marks are cleared and workspaces are reusable", () => {
  const marks = new Uint8Array(4);
  const pending = new Uint32Array(1);
  assert.equal(
    markIndexedGraph(graph([[1, 2], [], [], []], [0]), marks, pending),
    "capacity",
  );
  assert.ok(marks.every((v) => v === 0));
  assert.equal(
    markIndexedGraph(graph([[1], [], [], []], [0]), marks, pending, 1),
    "limit",
  );
  assert.ok(marks.every((v) => v === 0));
  assert.equal(
    markIndexedGraph(graph([[7], [], [], []], [0]), marks, pending),
    "invalid-graph",
  );
  assert.equal(
    markIndexedGraph(
      {
        ...graph([[], [], [], []], [0]),
        edgeAt: () => undefined,
        edgeCount: () => 1,
      },
      marks,
      pending,
    ),
    "read",
  );
  assert.ok(marks.every((v) => v === 0));
  assert.equal(
    markIndexedGraph(graph([[1], [], [], []], [0]), marks, pending),
    "complete",
  );
  assert.deepEqual([...marks], [2, 2, 0, 0]);
});
test("deep traversal uses supplied storage and validates graph dimensions and buffer overlap", () => {
  const count = 20000,
    marks = new Uint8Array(count);
  const g: IndexedGraph = {
    nodeCount: count,
    rootCount: 1,
    rootAt: () => 0,
    edgeCount: (n) => (n + 1 < count ? 1 : 0),
    edgeAt: (n) => n + 1,
  };
  assert.equal(markIndexedGraph(g, marks, new Uint32Array(1)), "complete");
  assert.ok(marks.every((v) => v === 2));
  assert.equal(
    markIndexedGraph({ ...g, rootCount: -1 }, marks, new Uint32Array(1)),
    "invalid-graph",
  );
  assert.equal(
    markIndexedGraph(g, new Uint8Array(1), new Uint32Array(1)),
    "capacity",
  );
  const buffer = new ArrayBuffer(16);
  assert.equal(
    markIndexedGraph(
      graph([[]], [0]),
      new Uint8Array(buffer),
      new Uint32Array(buffer),
    ),
    "invalid-graph",
  );
  assert.equal(
    markIndexedGraph({ ...g, rootAt: () => -1 }, marks, new Uint32Array(0)),
    "complete",
  );
  assert.ok(marks.every((v) => v === 0));
});

test("reader exceptions clear provisional marks and propagate without sweeping", () => {
  const marks = new Uint8Array(2);
  const error = new Error("read failed");
  assert.throws(
    () =>
      markIndexedGraph(
        {
          ...graph([[1], []], [0]),
          edgeCount: () => {
            throw error;
          },
        },
        marks,
        new Uint32Array(2),
      ),
    (e) => e === error,
  );
  assert.deepEqual([...marks], [0, 0]);
});

test("only the documented negative index is an absent reference", () => {
  const marks = new Uint8Array(1),
    pending = new Uint32Array(1);
  assert.equal(
    markIndexedGraph({ ...graph([[]], [0]), rootAt: () => -2 }, marks, pending),
    "invalid-graph",
  );
  assert.deepEqual([...marks], [0]);
});

test("streaming marker reuses its visitor and clears failures between scans", async () => {
  const { createGraphMarker } = await import("../src/graph/index.ts");
  const marks = new Uint8Array(3),
    pending = new Uint32Array(3);
  let mode = "ok",
    previous: ((edge: number | undefined) => boolean) | undefined;
  const scanner = {
    nodeCount: 3,
    rootCount: 1,
    rootAt: () => 0,
    scanEdges: (node: number, visit: (edge: number | undefined) => boolean) => {
      if (previous) assert.equal(visit, previous);
      previous = visit;
      if (mode === "throw") throw new Error("scan failure");
      if (mode === "read") return "read" as const;
      if (node === 0) {
        if (!visit(mode === "bad" ? 99 : 1)) return "complete" as const;
        visit(2);
      }
      return "complete" as const;
    },
  };
  const marker = createGraphMarker(scanner, marks, pending);
  assert.equal(marker.mark(), "complete");
  assert.deepEqual([...marks], [2, 2, 2]);
  for (const [next, expected] of [
    ["read", "read"],
    ["bad", "invalid-graph"],
  ]) {
    mode = next!;
    assert.equal(marker.mark(), expected);
    assert.deepEqual([...marks], [0, 0, 0]);
  }
  mode = "throw";
  assert.throws(() => marker.mark(), /scan failure/);
  assert.deepEqual([...marks], [0, 0, 0]);
  mode = "ok";
  assert.equal(marker.mark(2), "limit");
  assert.deepEqual([...marks], [0, 0, 0]);
  assert.equal(marker.mark(), "complete");
  assert.deepEqual([...marks], [2, 2, 2]);
});
