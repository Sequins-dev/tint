// DevTools profile formats from the shared sample model:
//
// - `.cpuprofile` (CDP Profiler.Profile): the JavaScript Profiler and
//   Performance panels load it; Profiler.stop returns it.
// - `.heapprofile` (CDP HeapProfiler.SamplingHeapProfile): the Memory
//   panel's allocation sampling view loads it; HeapProfiler.stopSampling
//   and getSamplingProfile return it.
//
// Line and column numbers are 0-based in both, as CDP requires; the model's
// are 1-based.
import {
  buildCallTree,
  sampleTypeIndex,
  type CallTreeNode,
  type SampleProfile,
} from "./samples.ts";

export interface CallFrame {
  readonly functionName: string;
  readonly scriptId: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}
export interface CpuProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly hitCount: number;
  readonly children?: number[];
  readonly positionTicks?: { line: number; ticks: number }[];
}
export interface CpuProfile {
  readonly nodes: CpuProfileNode[];
  /** Microseconds. */
  readonly startTime: number;
  readonly endTime: number;
  readonly samples: number[];
  readonly timeDeltas: number[];
}
export interface SamplingHeapProfileNode {
  readonly callFrame: CallFrame;
  readonly selfSize: number;
  readonly id: number;
  readonly children: SamplingHeapProfileNode[];
}
export interface SamplingHeapProfile {
  readonly head: SamplingHeapProfileNode;
  readonly samples: { size: number; nodeId: number; ordinal: number }[];
}

export interface FrameOptions {
  /** The script id of a file (the CDP bridge's Debugger.scriptParsed ids);
   * defaults to "0". */
  readonly scriptIdOf?: (file: string) => string | undefined;
  /** The url of a file; defaults to a file:// url of absolute paths. */
  readonly urlOf?: (file: string) => string;
}

export function defaultUrl(file: string): string {
  return file.startsWith("/")
    ? "file://" + encodeURI(file).replaceAll("#", "%23").replaceAll("?", "%3F")
    : file;
}

function callFrame(node: CallTreeNode, options: FrameOptions): CallFrame {
  const file = node.file;
  return {
    functionName: node.function,
    scriptId: file === undefined ? "0" : (options.scriptIdOf?.(file) ?? "0"),
    url: file === undefined ? "" : (options.urlOf ?? defaultUrl)(file),
    lineNumber: node.line > 0 ? node.line - 1 : -1,
    columnNumber: node.column > 0 ? node.column - 1 : -1,
  };
}

export interface CpuProfileOptions extends FrameOptions {
  /** Each sample's time in microseconds (default: a numeric `timestamp`
   * label in nanoseconds, else even spacing by the profile period). */
  readonly timeOf?: (index: number) => number | undefined;
  readonly startTime?: number;
  readonly endTime?: number;
}

/** The timestamp label pprofessor and the bridge's sampler attach. */
const timestampLabels = ["pprofessor::timestamp", "timestamp"];

export function toCpuProfile(
  profile: SampleProfile,
  options: CpuProfileOptions = {},
): CpuProfile {
  const tree = buildCallTree(profile),
    countIndex = sampleTypeIndex(profile, ["samples", "sample", "count"]);
  const periodMicros =
    profile.period !== undefined &&
    profile.period > 0 &&
    profile.periodType?.unit === "nanoseconds"
      ? profile.period / 1000
      : 10000;
  const timeOf = (index: number): number | undefined => {
    const given = options.timeOf?.(index);
    if (given !== undefined) return given;
    const labels = profile.samples[index]?.numLabels;
    for (const name of timestampLabels) {
      const value = labels?.[name];
      if (value !== undefined && value > 0) return value / 1000;
    }
    return undefined;
  };
  // Each sample may stand for several hits (pprof `samples` counts).
  const events: { time: number; node: number }[] = [];
  const base = (profile.timeNanos ?? 0) / 1000;
  profile.samples.forEach((sample, index) => {
    const node = tree.leaves[index];
    if (node === undefined) return;
    const hits = Math.max(1, Math.round(sample.values[countIndex] ?? 1));
    const time = timeOf(index) ?? base + events.length * periodMicros;
    for (let hit = 0; hit < hits; hit++)
      events.push({ time: time + hit * periodMicros, node: node.id });
  });
  events.sort((a, b) => a.time - b.time);
  const hitCounts = new Map<number, number>();
  for (const event of events)
    hitCounts.set(event.node, (hitCounts.get(event.node) ?? 0) + 1);
  const startTime =
    options.startTime ?? (events.length > 0 ? (events[0]?.time ?? 0) : base);
  const endTime =
    options.endTime ??
    (events.length > 0
      ? (events[events.length - 1]?.time ?? 0) + periodMicros
      : startTime);
  const nodes: CpuProfileNode[] = tree.nodes.map((node) => {
    const frame =
      node === tree.root
        ? {
            functionName: "(root)",
            scriptId: "0",
            url: "",
            lineNumber: -1,
            columnNumber: -1,
          }
        : callFrame(node, options);
    const ticks = [...node.lines]
      .sort((a, b) => a[0] - b[0])
      .map(([line, count]) => ({ line, ticks: count }));
    return {
      id: node.id,
      callFrame: frame,
      hitCount: hitCounts.get(node.id) ?? 0,
      ...(node.children.length > 0
        ? { children: node.children.map((child) => child.id) }
        : {}),
      ...(ticks.length > 0 ? { positionTicks: ticks } : {}),
    };
  });
  const samples: number[] = [],
    timeDeltas: number[] = [];
  let last = startTime;
  for (const event of events) {
    samples.push(event.node);
    timeDeltas.push(Math.max(0, Math.round(event.time - last)));
    last = Math.max(last, event.time);
  }
  return {
    nodes,
    startTime: Math.round(startTime),
    endTime: Math.round(Math.max(endTime, last)),
    samples,
    timeDeltas,
  };
}

export interface HeapProfileOptions extends FrameOptions {
  /** Sample type indices of object counts and bytes (defaults: by name,
   * alloc_objects/alloc_space). */
  readonly countIndex?: number;
  readonly bytesIndex?: number;
}

/** A sampling heap profile: each node's selfSize is the estimated bytes
 * allocated there; each sample is one recorded allocation (its size). */
export function toSamplingHeapProfile(
  profile: SampleProfile,
  options: HeapProfileOptions = {},
): SamplingHeapProfile {
  const tree = buildCallTree(profile),
    countIndex =
      options.countIndex ??
      sampleTypeIndex(profile, ["alloc_objects", "objects"], 0),
    bytesIndex =
      options.bytesIndex ??
      sampleTypeIndex(profile, ["alloc_space", "space", "bytes"], 1);
  const convert = (node: CallTreeNode): SamplingHeapProfileNode => ({
    callFrame:
      node === tree.root
        ? {
            functionName: "(root)",
            scriptId: "0",
            url: "",
            lineNumber: -1,
            columnNumber: -1,
          }
        : callFrame(node, options),
    selfSize: Math.round(node.self[bytesIndex] ?? 0),
    id: node.id,
    children: node.children.map(convert),
  });
  const samples = profile.samples.map((sample, index) => {
    const count = sample.values[countIndex] ?? 1,
      bytes = sample.values[bytesIndex] ?? 0;
    return {
      size: Math.round(count > 0 ? bytes / count : bytes),
      nodeId: tree.leaves[index]?.id ?? tree.root.id,
      ordinal: index + 1,
    };
  });
  return { head: convert(tree.root), samples };
}

/** Back to the model: a `.cpuprofile` as one-sample-per-tick samples with
 * timestamps (for pprof output or merging). */
export function fromCpuProfile(profile: CpuProfile): SampleProfile {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const stacks = new Map<number, SampleProfile["samples"][number]["stack"]>();
  const stackOf = (id: number): SampleProfile["samples"][number]["stack"] => {
    const known = stacks.get(id);
    if (known !== undefined) return known;
    const stack = [];
    for (
      let at: number | undefined = id;
      at !== undefined && parent.has(at);
      at = parent.get(at)
    ) {
      const frame = byId.get(at)?.callFrame;
      if (frame === undefined) break;
      stack.push({
        lines: [
          {
            function: frame.functionName,
            file: frame.url === "" ? undefined : frame.url,
            line: frame.lineNumber + 1,
            column: frame.columnNumber + 1,
          },
        ],
      });
    }
    stacks.set(id, stack);
    return stack;
  };
  let time = profile.startTime;
  return {
    sampleTypes: [
      { type: "samples", unit: "count" },
      { type: "cpu", unit: "nanoseconds" },
    ],
    periodType: { type: "cpu", unit: "nanoseconds" },
    samples: profile.samples.map((id, index) => {
      const delta = profile.timeDeltas[index] ?? 0;
      time += delta;
      return {
        stack: stackOf(id),
        values: [1, delta * 1000],
        numLabels: { timestamp: time * 1000 },
      };
    }),
    timeNanos: profile.startTime * 1000,
    durationNanos: (profile.endTime - profile.startTime) * 1000,
  };
}
