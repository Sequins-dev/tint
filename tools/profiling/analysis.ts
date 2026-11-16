// Reachability, the dominator tree (Cooper, Harvey and Kennedy's iterative
// algorithm over a reverse postorder) and retained sizes of a heap graph,
// on a virtual graph: node 0 is the root, 1..F are stack frames, then the
// objects. Weak edges neither retain nor dominate, as in V8 snapshots.
import { edgeWeak, type HeapGraph } from "./heap-graph.ts";

export interface HeapAnalysis {
  readonly graph: HeapGraph;
  /** Virtual node count (root + frames + objects). */
  readonly total: number;
  readonly frameBase: number;
  readonly objectBase: number;
  readonly reachable: Uint8Array;
  readonly reachableCount: number;
  readonly reachableBytes: number;
  /** Immediate dominator by virtual node (root: itself; unreachable: -1). */
  readonly idom: Int32Array;
  readonly retained: Float64Array;
  /** Virtual nodes in reverse postorder (dominators before dominatees). */
  readonly order: Uint32Array;
}

function successors(
  graph: HeapGraph,
  node: number,
  frameBase: number,
  objectBase: number,
  visit: (target: number) => void,
): void {
  if (node === 0) {
    for (let frame = 0; frame < graph.frames.length; frame++)
      visit(frameBase + frame);
    return;
  }
  if (node < objectBase) {
    const roots = graph.frames[node - frameBase]?.roots ?? [];
    for (let index = 1; index < roots.length; index += 2)
      visit(objectBase + (roots[index] ?? 0));
    return;
  }
  const object = node - objectBase,
    end = graph.edgeStart[object + 1] ?? 0;
  for (let edge = graph.edgeStart[object] ?? 0; edge < end; edge++)
    if (graph.edgeType[edge] !== edgeWeak)
      visit(objectBase + (graph.edgeTarget[edge] ?? 0));
}

export function analyze(graph: HeapGraph): HeapAnalysis {
  const frameBase = 1,
    objectBase = 1 + graph.frames.length,
    total = objectBase + graph.count;
  // Iterative DFS: postorder numbers and reachability.
  const post = new Int32Array(total).fill(-1),
    order: number[] = [],
    reachable = new Uint8Array(total);
  // Cursor: the next frame (root), root pair (frame) or edge (object).
  const stack = new Uint32Array(total),
    cursor = new Uint32Array(total);
  for (let object = 0; object < graph.count; object++)
    cursor[objectBase + object] = graph.edgeStart[object] ?? 0;
  const next = (node: number): number => {
    let at = cursor[node] ?? 0;
    if (node === 0) {
      if (at >= graph.frames.length) return -1;
      cursor[node] = at + 1;
      return frameBase + at;
    }
    if (node < objectBase) {
      const roots = graph.frames[node - frameBase]?.roots ?? [];
      if (at * 2 + 1 >= roots.length) return -1;
      cursor[node] = at + 1;
      return objectBase + (roots[at * 2 + 1] ?? 0);
    }
    const end = graph.edgeStart[node - objectBase + 1] ?? 0;
    while (at < end && graph.edgeType[at] === edgeWeak) at++;
    if (at >= end) {
      cursor[node] = at;
      return -1;
    }
    cursor[node] = at + 1;
    return objectBase + (graph.edgeTarget[at] ?? 0);
  };
  let top = 0;
  stack[top++] = 0;
  reachable[0] = 1;
  while (top > 0) {
    const node = stack[top - 1] ?? 0,
      target = next(node);
    if (target >= 0) {
      if (reachable[target] === 0) {
        reachable[target] = 1;
        stack[top++] = target;
      }
      continue;
    }
    post[node] = order.length;
    order.push(node);
    top--;
  }
  const count = order.length;
  // Predecessors among reachable nodes (CSR by postorder number).
  const predecessorCount = new Uint32Array(count + 1);
  for (let index = 0; index < count; index++) {
    const node = order[index] ?? 0;
    successors(graph, node, frameBase, objectBase, (target) => {
      const number = post[target] ?? -1;
      if (number >= 0)
        predecessorCount[number + 1] = (predecessorCount[number + 1] ?? 0) + 1;
    });
  }
  for (let index = 0; index < count; index++)
    predecessorCount[index + 1] =
      (predecessorCount[index + 1] ?? 0) + (predecessorCount[index] ?? 0);
  const predecessors = new Uint32Array(predecessorCount[count] ?? 0),
    fill = predecessorCount.slice(0, count);
  for (let index = 0; index < count; index++) {
    const node = order[index] ?? 0;
    successors(graph, node, frameBase, objectBase, (target) => {
      const number = post[target] ?? -1;
      if (number >= 0) {
        const slot = fill[number] ?? 0;
        predecessors[slot] = index;
        fill[number] = slot + 1;
      }
    });
  }
  // Dominators by postorder number; the root has the highest number.
  const dom = new Int32Array(count).fill(-1),
    rootNumber = count - 1;
  dom[rootNumber] = rootNumber;
  const intersect = (left: number, right: number): number => {
    let a = left,
      b = right;
    while (a !== b) {
      while (a < b) a = dom[a] ?? 0;
      while (b < a) b = dom[b] ?? 0;
    }
    return a;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let number = rootNumber - 1; number >= 0; number--) {
      let chosen = -1;
      const end = predecessorCount[number + 1] ?? 0;
      for (let at = predecessorCount[number] ?? 0; at < end; at++) {
        const predecessor = predecessors[at] ?? 0;
        if (dom[predecessor] === -1) continue;
        chosen = chosen === -1 ? predecessor : intersect(predecessor, chosen);
      }
      if (chosen !== -1 && dom[number] !== chosen) {
        dom[number] = chosen;
        changed = true;
      }
    }
  }
  const idom = new Int32Array(total).fill(-1),
    retained = new Float64Array(total);
  let reachableCount = 0,
    reachableBytes = 0;
  for (let number = 0; number < count; number++) {
    const node = order[number] ?? 0;
    idom[node] = order[dom[number] ?? 0] ?? 0;
    if (node >= objectBase) {
      const bytes = graph.size[node - objectBase] ?? 0;
      retained[node] = (retained[node] ?? 0) + bytes;
      reachableCount++;
      reachableBytes += bytes;
    }
  }
  // Postorder: dominatees before dominators.
  for (let number = 0; number < rootNumber; number++) {
    const node = order[number] ?? 0;
    const dominator = idom[node] ?? 0;
    retained[dominator] = (retained[dominator] ?? 0) + (retained[node] ?? 0);
  }
  const reverse = new Uint32Array(count);
  for (let number = 0; number < count; number++)
    reverse[number] = order[count - 1 - number] ?? 0;
  return {
    graph,
    total,
    frameBase,
    objectBase,
    reachable,
    reachableCount,
    reachableBytes,
    idom,
    retained,
    order: reverse,
  };
}

export interface TypeSummary {
  readonly name: string;
  readonly category: string;
  objects: number;
  bytes: number;
  /** Bytes retained by the type's objects not dominated by another object
   * of the same type (DevTools' constructor retained size). */
  retained: number;
}
export interface DominatorSummary {
  readonly type: string;
  readonly address: string;
  readonly self: number;
  readonly retained: number;
  readonly path: readonly string[];
}
export interface HeapReport {
  readonly label: string;
  readonly totals: {
    readonly objects: number;
    readonly bytes: number;
    readonly reachableObjects: number;
    readonly reachableBytes: number;
    readonly headerBytes: number;
    readonly oldBytes: number;
    readonly youngBytes: number;
    readonly edges: number;
    readonly imageReferences: number;
    readonly rootReferences: number;
  };
  readonly categories: readonly TypeSummary[];
  readonly types: readonly TypeSummary[];
  readonly dominators: readonly DominatorSummary[];
  readonly frames: readonly {
    readonly name: string;
    readonly retained: number;
  }[];
}

export function typeName(analysis: HeapAnalysis, node: number): string {
  const graph = analysis.graph;
  if (node === 0) return "(root)";
  if (node < analysis.objectBase)
    return "frame " + (graph.frames[node - analysis.frameBase]?.name ?? "?");
  return graph.types[graph.type[node - analysis.objectBase] ?? 0]?.name ?? "?";
}

/** Dominator-tree children (CSR) of the reachable virtual nodes. */
function dominatorChildren(analysis: HeapAnalysis): {
  start: Uint32Array;
  list: Uint32Array;
} {
  const { total, idom } = analysis,
    start = new Uint32Array(total + 1);
  for (let node = 1; node < total; node++) {
    const parent = idom[node] ?? -1;
    if (parent >= 0) start[parent + 1] = (start[parent + 1] ?? 0) + 1;
  }
  for (let node = 0; node < total; node++)
    start[node + 1] = (start[node + 1] ?? 0) + (start[node] ?? 0);
  const list = new Uint32Array(start[total] ?? 0),
    fill = start.slice(0, total);
  for (let node = 1; node < total; node++) {
    const parent = idom[node] ?? -1;
    if (parent >= 0) {
      const slot = fill[parent] ?? 0;
      list[slot] = node;
      fill[parent] = slot + 1;
    }
  }
  return { start, list };
}

/** Totals a producer adds to the report (Tint: header, space and image
 * reference counts). */
export interface ReportTotals {
  readonly headerBytes?: number;
  readonly oldBytes?: number;
  readonly youngBytes?: number;
  readonly imageReferences?: number;
}

export function report(
  analysis: HeapAnalysis,
  label: string,
  topDominators = 40,
  extra: ReportTotals = {},
): HeapReport {
  const graph = analysis.graph,
    objectBase = analysis.objectBase;
  const types: TypeSummary[] = graph.types.map((type) => ({
    name: type.name,
    category: type.category,
    objects: 0,
    bytes: 0,
    retained: 0,
  }));
  for (let object = 0; object < graph.count; object++) {
    if (analysis.reachable[objectBase + object] === 0) continue;
    const summary = types[graph.type[object] ?? 0];
    if (summary === undefined) continue;
    summary.objects++;
    summary.bytes += graph.size[object] ?? 0;
  }
  // Constructor retained sizes: a preorder walk of the dominator tree that
  // counts each type's outermost objects only.
  const { start, list } = dominatorChildren(analysis),
    active = new Uint32Array(types.length),
    stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop() ?? 0;
    if (node >= 0x80000000) {
      const object = node - 0x80000000;
      const type = graph.type[object] ?? 0;
      active[type] = (active[type] ?? 1) - 1;
      continue;
    }
    if (node >= objectBase) {
      const object = node - objectBase,
        type = graph.type[object] ?? 0;
      if (active[type] === 0) {
        const summary = types[type];
        if (summary !== undefined)
          summary.retained += analysis.retained[node] ?? 0;
      }
      active[type] = (active[type] ?? 0) + 1;
      stack.push(0x80000000 + object);
    }
    const end = start[node + 1] ?? 0;
    for (let at = start[node] ?? 0; at < end; at++) stack.push(list[at] ?? 0);
  }
  const categories = new Map<string, TypeSummary>();
  for (const summary of types) {
    const entry =
      categories.get(summary.category) ??
      ({
        name: summary.category,
        category: summary.category,
        objects: 0,
        bytes: 0,
        retained: 0,
      } as TypeSummary);
    entry.objects += summary.objects;
    entry.bytes += summary.bytes;
    categories.set(summary.category, entry);
  }
  // Largest single dominators among objects.
  const candidates: number[] = [];
  for (let object = 0; object < graph.count; object++)
    if (analysis.reachable[objectBase + object] !== 0)
      candidates.push(objectBase + object);
  candidates.sort(
    (a, b) => (analysis.retained[b] ?? 0) - (analysis.retained[a] ?? 0),
  );
  const dominators: DominatorSummary[] = [];
  const shown = new Set<number>();
  for (const node of candidates) {
    if (dominators.length >= topDominators) break;
    // Skip objects whose own dominator is already listed with nearly the
    // same retained size (chains of single owners).
    const parent = analysis.idom[node] ?? 0;
    shown.add(node);
    if (
      shown.has(parent) &&
      (analysis.retained[node] ?? 0) >= 0.5 * (analysis.retained[parent] ?? 0)
    )
      continue;
    const path: string[] = [];
    let repeated = 0;
    for (let at = parent, depth = 0; at > 0 && depth < 16;) {
      const name = typeName(analysis, at),
        last = path[path.length - 1];
      if (last !== undefined && last.replace(/ ×\d+$/, "") === name) {
        repeated++;
        path[path.length - 1] = name + " ×" + (repeated + 1);
      } else {
        repeated = 0;
        path.push(name);
        depth++;
      }
      at = analysis.idom[at] ?? 0;
    }
    // Several frames (or roots) retain it: only the root dominates.
    if (path.length < 16) path.push("(root)");
    dominators.push({
      type: typeName(analysis, node),
      address: "0x" + (graph.address[node - objectBase] ?? 0).toString(16),
      self: graph.size[node - objectBase] ?? 0,
      retained: analysis.retained[node] ?? 0,
      path,
    });
  }
  let totalBytes = 0,
    rootReferences = 0;
  for (let object = 0; object < graph.count; object++)
    totalBytes += graph.size[object] ?? 0;
  for (const frame of graph.frames) rootReferences += frame.roots.length / 2;
  const frames = graph.frames.map((frame, index) => ({
    name: frame.name,
    retained: analysis.retained[analysis.frameBase + index] ?? 0,
  }));
  return {
    label,
    totals: {
      objects: graph.count,
      bytes: totalBytes,
      reachableObjects: analysis.reachableCount,
      reachableBytes: analysis.reachableBytes,
      headerBytes: extra.headerBytes ?? 0,
      oldBytes: extra.oldBytes ?? 0,
      youngBytes: extra.youngBytes ?? 0,
      edges: graph.edgeTarget.length,
      imageReferences: extra.imageReferences ?? 0,
      rootReferences,
    },
    categories: [...categories.values()].sort((a, b) => b.bytes - a.bytes),
    types: types
      .filter((summary) => summary.objects > 0)
      .sort((a, b) => b.bytes - a.bytes),
    dominators,
    frames,
  };
}
