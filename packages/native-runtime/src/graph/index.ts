/** Reader results use nonnegative node indices, -1 for no reference, and
 * undefined for a failed read. The scalar ABI avoids allocating union boxes
 * while tracing the managed heap. Readers must not allocate or reenter GC. */
export interface IndexedGraph {
  readonly nodeCount: number;
  readonly rootCount: number;
  readonly rootAt: (index: number) => number | undefined;
  readonly edgeCount: (node: number) => number | undefined;
  readonly edgeAt: (node: number, index: number) => number | undefined;
}
export type MarkStatus =
  "complete" | "invalid-graph" | "capacity" | "limit" | "read";
export interface TraversableGraph {
  readonly nodeCount: number;
  readonly rootCount: number;
  readonly rootAt: (index: number) => number | undefined;
  /** Synchronously visit each edge once; stop when the visitor returns false.
   * Neither the scanner nor visitor may allocate or retain/reenter the visitor. */
  readonly scanEdges: (
    node: number,
    visit: (edge: number | undefined) => boolean,
  ) => MarkStatus;
}
export interface GraphMarker {
  readonly mark: (maxSteps?: number) => MarkStatus;
}
/** Create reusable control state outside the heap being marked. Mark itself
 * allocates no objects; all traversal storage is supplied by the caller. */
export function createGraphMarker(
  graph: TraversableGraph,
  marks: Uint8Array,
  pending: Uint32Array,
): GraphMarker {
  let top = 0,
    steps = 0,
    limit = 0,
    count = 0,
    active = false;
  let status: MarkStatus = "complete";
  function visit(edge: number | undefined): boolean {
    if (status !== "complete") return false;
    if (++steps > limit) {
      status = "limit";
      return false;
    }
    top = enqueue(edge, count, marks, pending, top);
    if (top < 0) {
      status = failure(top);
      return false;
    }
    return true;
  }
  return {
    mark: (maxSteps: number = 1000000): MarkStatus => {
      if (active) return "invalid-graph";
      const nodeCount = graph.nodeCount,
        rootCount = graph.rootCount;
      if (!bounded(nodeCount) || !bounded(rootCount) || !bounded(maxSteps))
        return "invalid-graph";
      if (
        marks.buffer === pending.buffer &&
        marks.byteOffset < pending.byteOffset + pending.byteLength &&
        pending.byteOffset < marks.byteOffset + marks.byteLength
      )
        return "invalid-graph";
      if (marks.length < nodeCount) return "capacity";
      marks.fill(0);
      top = 0;
      steps = 0;
      limit = maxSteps;
      count = nodeCount;
      status = "complete";
      let complete = false;
      active = true;
      try {
        for (let i = 0; i < rootCount; i++) {
          if (steps >= limit) return "limit";
          if (!visit(graph.rootAt(i))) return status;
        }
        while (top > 0) {
          if (++steps > limit) return "limit";
          const node = pending[--top];
          if (node === undefined) return "invalid-graph";
          const scanned = graph.scanEdges(node, visit);
          if (status !== "complete") return status;
          if (scanned !== "complete") return scanned;
          marks[node] = 2;
        }
        complete = true;
        return "complete";
      } finally {
        active = false;
        if (!complete) marks.fill(0);
      }
    },
  };
}
/** Random-access variant for pre-indexed edge storage; no setup allocation. */
export function markIndexedGraph(
  graph: IndexedGraph,
  marks: Uint8Array,
  pending: Uint32Array,
  maxSteps: number = 1000000,
): MarkStatus {
  const nodeCount = graph.nodeCount,
    rootCount = graph.rootCount;
  if (!bounded(nodeCount) || !bounded(rootCount) || !bounded(maxSteps))
    return "invalid-graph";
  if (
    marks.buffer === pending.buffer &&
    marks.byteOffset < pending.byteOffset + pending.byteLength &&
    pending.byteOffset < marks.byteOffset + marks.byteLength
  )
    return "invalid-graph";
  if (marks.length < nodeCount) return "capacity";
  marks.fill(0);
  let top = 0,
    steps = 0,
    complete = false;
  try {
    for (let i = 0; i < rootCount; i++) {
      if (++steps > maxSteps) return "limit";
      top = enqueue(graph.rootAt(i), nodeCount, marks, pending, top);
      if (top < 0) return failure(top);
    }
    while (top > 0) {
      if (++steps > maxSteps) return "limit";
      const node = pending[--top];
      if (node === undefined) return "invalid-graph";
      const edges = graph.edgeCount(node);
      if (edges === undefined) return "read";
      if (!bounded(edges)) return "invalid-graph";
      for (let i = 0; i < edges; i++) {
        if (++steps > maxSteps) return "limit";
        top = enqueue(graph.edgeAt(node, i), nodeCount, marks, pending, top);
        if (top < 0) return failure(top);
      }
      marks[node] = 2;
    }
    complete = true;
    return "complete";
  } finally {
    if (!complete) marks.fill(0);
  }
}

function bounded(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function enqueue(
  node: number | undefined,
  nodeCount: number,
  marks: Uint8Array,
  pending: Uint32Array,
  top: number,
): number {
  if (node === undefined) return -1;
  if (node === -1) return top;
  if (!bounded(node) || node >= nodeCount) return -2;
  if (marks[node] !== 0) return top;
  if (top >= pending.length) return -3;
  marks[node] = 1;
  pending[top] = node;
  return top + 1;
}
function failure(code: number): MarkStatus {
  if (code === -1) return "read";
  if (code === -3) return "capacity";
  return "invalid-graph";
}
