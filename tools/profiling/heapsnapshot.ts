// Writes a V8 `.heapsnapshot` (the format Chrome DevTools' Memory panel,
// Node's inspector, CDP's HeapProfiler.addHeapSnapshotChunk and Memlab
// read) from a neutral heap graph: a synthetic root, "(GC roots)" and
// "(Stack roots)", one synthetic node per stack frame holding references,
// then every reachable object (or all objects).
import { closeSync, openSync, writeSync } from "node:fs";
import {
  edgeElement,
  edgeInternal,
  edgeProperty,
  edgeWeak,
  type HeapGraph,
} from "./heap-graph.ts";
import type { HeapAnalysis } from "./analysis.ts";

const nodeTypes = [
  "hidden",
  "array",
  "string",
  "object",
  "code",
  "closure",
  "regexp",
  "number",
  "native",
  "synthetic",
  "concatenated string",
  "sliced string",
  "symbol",
  "bigint",
  "object shape",
];
const edgeTypes = [
  "context",
  "element",
  "property",
  "internal",
  "hidden",
  "shortcut",
  "weak",
];
const nodeFieldCount = 7;
const typeIndex = (name: string): number => nodeTypes.indexOf(name);
const edgeIndex = (name: string): number => edgeTypes.indexOf(name);

/** Where snapshot text goes, in chunks of about a megabyte. */
export interface TextSink {
  write(chunk: string): void;
  close(): void;
}
export function fileSink(path: string): TextSink {
  const fd = openSync(path, "w");
  return {
    write: (chunk) => {
      writeSync(fd, chunk);
    },
    close: () => {
      closeSync(fd);
    },
  };
}
class Output {
  private buffer = "";
  private readonly sink: TextSink;
  constructor(sink: TextSink) {
    this.sink = sink;
  }
  write(text: string): void {
    this.buffer += text;
    if (this.buffer.length > 1 << 20) this.flush();
  }
  flush(): void {
    if (this.buffer.length > 0) this.sink.write(this.buffer);
    this.buffer = "";
  }
}

export interface SnapshotOptions {
  readonly includeUnreachable?: boolean;
  /** Characters of string contents kept as node names. */
  readonly stringLimit?: number;
}
export interface SnapshotTotals {
  readonly nodes: number;
  readonly edges: number;
  readonly objects: number;
  readonly bytes: number;
}

/** Writes the snapshot to a file path or a sink (closed when done). */
export function writeHeapSnapshot(
  analysis: HeapAnalysis,
  target: string | TextSink,
  options: SnapshotOptions = {},
): SnapshotTotals {
  const graph: HeapGraph = analysis.graph,
    objectBase = analysis.objectBase,
    stringLimit = options.stringLimit ?? 1024;
  const included = (object: number): boolean =>
    options.includeUnreachable === true ||
    analysis.reachable[objectBase + object] !== 0;
  // Node indices: 0 root, 1 (GC roots), 2 (Stack roots), frames, objects.
  const firstFrame = 3,
    firstObject = firstFrame + graph.frames.length,
    nodeIndex = new Int32Array(graph.count).fill(-1);
  let objects = 0,
    bytes = 0;
  for (let object = 0; object < graph.count; object++)
    if (included(object)) {
      nodeIndex[object] = firstObject + objects++;
      bytes += graph.size[object] ?? 0;
    }
  const strings: string[] = [],
    stringIds = new Map<string, number>();
  const string = (text: string): number => {
    const known = stringIds.get(text);
    if (known !== undefined) return known;
    strings.push(text);
    stringIds.set(text, strings.length - 1);
    return strings.length - 1;
  };
  let edgeTotal = 1 + 1 + graph.frames.length;
  for (const frame of graph.frames) edgeTotal += frame.roots.length / 2;
  for (let object = 0; object < graph.count; object++) {
    if (!included(object)) continue;
    const end = graph.edgeStart[object + 1] ?? 0;
    for (let edge = graph.edgeStart[object] ?? 0; edge < end; edge++)
      if ((nodeIndex[graph.edgeTarget[edge] ?? 0] ?? -1) >= 0) edgeTotal++;
  }
  const nodeTotal = firstObject + objects;
  const sink = typeof target === "string" ? fileSink(target) : target,
    out = new Output(sink);
  out.write(
    '{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count","trace_node_id","detachedness"],"node_types":[' +
      JSON.stringify(nodeTypes) +
      ',"string","number","number","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[' +
      JSON.stringify(edgeTypes) +
      ',"string_or_number","node"],"trace_function_info_fields":["function_id","name","script_name","script_id","line","column"],"trace_node_fields":["id","function_info_index","count","size","children"],"sample_fields":["timestamp_us","last_assigned_id"],"location_fields":["object_index","script_id","line","column"]},"node_count":' +
      nodeTotal +
      ',"edge_count":' +
      edgeTotal +
      ',"trace_function_count":0},\n"nodes":[',
  );
  let first = true;
  const node = (
    type: string,
    name: string,
    id: number,
    selfSize: number,
    edgeCount: number,
  ): void => {
    out.write(
      (first ? "" : ",\n") +
        typeIndex(type) +
        "," +
        string(name) +
        "," +
        id +
        "," +
        selfSize +
        "," +
        edgeCount +
        ",0,0",
    );
    first = false;
  };
  node("synthetic", "", 1, 0, 1);
  node("synthetic", "(GC roots)", 3, 0, 1);
  node("synthetic", "(Stack roots)", 5, 0, graph.frames.length);
  graph.frames.forEach((frame, index) =>
    node("synthetic", frame.name, 7 + index * 2, 0, frame.roots.length / 2),
  );
  for (let object = 0; object < graph.count; object++) {
    if (!included(object)) continue;
    const info = graph.types[graph.type[object] ?? 0];
    let edgeCount = 0;
    const end = graph.edgeStart[object + 1] ?? 0;
    for (let edge = graph.edgeStart[object] ?? 0; edge < end; edge++)
      if ((nodeIndex[graph.edgeTarget[edge] ?? 0] ?? -1) >= 0) edgeCount++;
    const id = graph.id(object);
    const category = info?.category ?? "record";
    const type =
      category === "string"
        ? "string"
        : category === "vector"
          ? "array"
          : category === "function"
            ? "closure"
            : category === "environment"
              ? "hidden"
              : category === "buffer" || category === "native"
                ? "native"
                : "object";
    const name = graph.label?.(object, stringLimit) ?? info?.name ?? "?";
    node(type, name, id, graph.size[object] ?? 0, edgeCount);
  }
  out.write('],\n"edges":[');
  first = true;
  const edge = (type: string, nameOrIndex: number, to: number): void => {
    out.write(
      (first ? "" : ",\n") +
        edgeIndex(type) +
        "," +
        nameOrIndex +
        "," +
        to * nodeFieldCount,
    );
    first = false;
  };
  edge("element", 1, 1);
  edge("element", 1, 2);
  graph.frames.forEach((_, index) =>
    edge("element", index + 1, firstFrame + index),
  );
  for (const frame of graph.frames)
    for (let at = 0; at < frame.roots.length; at += 2)
      edge(
        "property",
        string(graph.names[frame.roots[at] ?? 0] ?? "?"),
        nodeIndex[frame.roots[at + 1] ?? 0] ?? 0,
      );
  for (let object = 0; object < graph.count; object++) {
    if (!included(object)) continue;
    const end = graph.edgeStart[object + 1] ?? 0;
    for (let at = graph.edgeStart[object] ?? 0; at < end; at++) {
      const target = nodeIndex[graph.edgeTarget[at] ?? 0] ?? -1;
      if (target < 0) continue;
      const kind = graph.edgeType[at],
        label = graph.edgeName[at] ?? 0;
      if (kind === edgeElement) edge("element", label, target);
      else
        edge(
          kind === edgeProperty
            ? "property"
            : kind === edgeInternal
              ? "internal"
              : kind === edgeWeak
                ? "weak"
                : "hidden",
          string(graph.names[label] ?? "?"),
          target,
        );
    }
  }
  out.write(
    '],\n"trace_function_infos":[],"trace_tree":[],"samples":[],"locations":[],\n"strings":[',
  );
  strings.forEach((text, index) =>
    out.write((index === 0 ? "" : ",\n") + JSON.stringify(text)),
  );
  out.write("]}\n");
  out.flush();
  sink.close();
  return { nodes: nodeTotal, edges: edgeTotal, objects, bytes };
}
