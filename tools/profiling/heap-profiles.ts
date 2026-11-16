// Sample profiles derived from heaps and allocation samples:
//
// - inUseSamples: in-use space by dominator path, from a heap analysis.
// - readAllocationSamples: sampled allocations (the JSON lines that
//   `tint-heap sample` and the DevTools bridge record) as alloc_objects /
//   alloc_space samples.
//
// Both feed pprof (encodeProfile) and, for allocations, the DevTools
// sampling heap profile (toSamplingHeapProfile).
import { readFileSync } from "node:fs";
import { typeName, type HeapAnalysis } from "./analysis.ts";
import type { Sample, SampleProfile } from "./samples.ts";

/** In-use space by dominator path: each object's stack is its type, then
 * the types of its dominator chain (consecutive equal types merged) up to
 * the stack frame that retains it, so a flame graph shows who retains
 * memory. */
export function inUseSamples(analysis: HeapAnalysis): SampleProfile {
  const graph = analysis.graph,
    objectBase = analysis.objectBase,
    maxDepth = 64;
  const head = new Int32Array(analysis.total).fill(-1),
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
    if (node >= objectBase) {
      const entry = counts.get(path) ?? [0, 0];
      entry[0] += 1;
      entry[1] += graph.size[node - objectBase] ?? 0;
      counts.set(path, entry);
    }
  }
  const samples: Sample[] = [];
  for (const [path, [objects, bytes]] of counts) {
    const stack = [];
    for (let at = path; at >= 0; at = paths[at]?.parent ?? -1)
      stack.push({ lines: [{ function: paths[at]?.name ?? "?" }] });
    samples.push({ stack, values: [objects, bytes] });
  }
  return {
    sampleTypes: [
      { type: "inuse_objects", unit: "count" },
      { type: "inuse_space", unit: "bytes" },
    ],
    samples,
    defaultSampleType: "inuse_space",
    comments: ["Heap snapshot: stacks are dominator paths of object types"],
    timeNanos: Math.round((graph.timeSeconds ?? 0) * 1e9),
  };
}

/** One sampled allocation, as recorded (stack leaf first). */
export interface AllocationRecord {
  readonly address: number;
  readonly size: number;
  /** In the nursery (Poisson-sampled) rather than placed directly in an
   * old space (every such allocation takes the slow path). */
  readonly young: boolean;
  readonly type: string | null;
  readonly stack: readonly {
    readonly pc: number;
    readonly lines: readonly {
      readonly function: string;
      readonly file: string | null;
      readonly line: number;
      readonly column?: number;
    }[];
  }[];
}
export interface AllocationHeader {
  readonly interval: number;
  readonly image: { path: string; loadAddress: number; uuid: string };
}

/** alloc_objects/alloc_space from sampled allocations. Each nursery
 * sample stands for 1 / (1 - exp(-size / interval)) objects (Poisson
 * sampling over allocated bytes); allocations placed directly in the old
 * space always take the slow path and count once. */
export function allocationSamples(
  header: AllocationHeader,
  records: readonly AllocationRecord[],
): { profile: SampleProfile; bytes: number } {
  const samples: Sample[] = [];
  let estimated = 0;
  for (const record of records) {
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
          column: entry.column,
        })),
      })),
      values: [weight, weight * record.size],
      labels: {
        type: record.type ?? "(unknown)",
        space: record.young ? "nursery" : "old",
      },
    });
  }
  const profile: SampleProfile = {
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
    comments: ["Allocation samples via __tint_allocation_sample"],
  };
  return { profile, bytes: estimated };
}

/** Reads a JSON-lines sample file: a header line, then one record each. */
export function readAllocationSamples(path: string): {
  profile: SampleProfile;
  bytes: number;
} {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean),
    header = JSON.parse(lines[0] ?? "{}") as AllocationHeader;
  return allocationSamples(
    header,
    lines.slice(1).map((line) => JSON.parse(line) as AllocationRecord),
  );
}
