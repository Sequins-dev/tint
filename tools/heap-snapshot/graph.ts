// The object graph of a heap dump: every object found through the start
// bits (decoded by the descriptor's kind table or its record descriptor),
// its outgoing references (record descriptors, vector slots, view owners,
// weak slots) named from DWARF, and the stack roots found by walking the
// frames with the image's safepoint maps (the runtime's own walker).
import { walkNativeStack } from "@tint/native-runtime/tracing";
import {
  edgeElement,
  edgeInternal,
  edgeProperty,
  edgeWeak,
  type HeapGraph,
  type NodeCategory,
  type RootFrame,
  type TypeInfo,
} from "../profiling/heap-graph.ts";
import type { ReportTotals } from "../profiling/analysis.ts";
import { HeapDump, splitHeader, wordAt, type RecordInfo } from "./dump.ts";

export {
  edgeElement,
  edgeInternal,
  edgeProperty,
  edgeWeak,
  type NodeCategory,
  type RootFrame,
  type TypeInfo,
};
/** A Tint heap dump's graph: the neutral graph plus its dump and the
 * decoder's statistics. */
export interface TintHeapGraph extends HeapGraph {
  readonly dump: HeapDump;
  readonly stats: GraphStats;
}
export interface GraphStats {
  objects: number;
  bytes: number;
  oldBytes: number;
  youngBytes: number;
  headerBytes: number;
  edges: number;
  imageReferences: number;
  danglingReferences: number;
  rootReferences: number;
  rootWalk: string;
  /** The in-flight allocation at the sample hook, excluded. */
  pendingBytes: number;
}

class Growable {
  data: Uint32Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Uint32Array(capacity);
  }
  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Uint32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
  finish(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}
class GrowableF64 {
  data: Float64Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Float64Array(capacity);
  }
  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Float64Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
  finish(): Float64Array {
    return this.data.slice(0, this.length);
  }
}

interface DescriptorInfo {
  readonly size: number;
  readonly references: readonly number[];
  readonly generals: readonly number[];
  readonly fieldNames: Map<number, number>;
  readonly type: number;
}

export function buildGraph(dump: HeapDump): TintHeapGraph {
  const meta = dump.meta,
    descriptor = meta.descriptor,
    state = descriptor.state,
    granule = descriptor.granule,
    headerBytes = descriptor.headerBytes;
  const names: string[] = [],
    nameIds = new Map<string, number>();
  const name = (text: string): number => {
    const known = nameIds.get(text);
    if (known !== undefined) return known;
    names.push(text);
    nameIds.set(text, names.length - 1);
    return names.length - 1;
  };
  const types: TypeInfo[] = [],
    typeIds = new Map<string, number>();
  const typeId = (typeName: string, category: NodeCategory): number => {
    const key = category + ":" + typeName,
      known = typeIds.get(key);
    if (known !== undefined) return known;
    types.push({ name: typeName, category });
    typeIds.set(key, types.length - 1);
    return types.length - 1;
  };
  const kinds = new Map<number, { index: number; type: number }>();
  descriptor.kinds.forEach((kind, index) => {
    const category: NodeCategory =
      kind.marker === 1
        ? "string"
        : kind.marker === 6
          ? "vector"
          : kind.marker === 7
            ? "weak"
            : "buffer";
    kinds.set(kind.marker * 8 + kind.flags, {
      index,
      type: typeId(kind.name, category),
    });
  });
  const maxKind = Math.max(...descriptor.kinds.map((kind) => kind.marker));
  const records = new Map<number, DescriptorInfo>();
  const recordInfo = (marker: number): DescriptorInfo => {
    const known = records.get(marker);
    if (known !== undefined) return known;
    const size = dump.read(marker) ?? 0,
      count = dump.read(marker + 8) ?? 0,
      references: number[] = [],
      generals: number[] = [];
    for (let index = 0; index < count; index++)
      references.push(dump.read(marker + 16 + index * 8) ?? 0);
    const generalAt = marker + 16 + count * 8,
      generalCount = dump.read(generalAt) ?? 0;
    for (let index = 0; index < generalCount; index++)
      generals.push(dump.read(generalAt + 8 + index * 8) ?? 0);
    const info: RecordInfo | undefined = meta.records[String(marker)];
    const fieldNames = new Map<number, number>();
    for (const field of info?.fields ?? [])
      if (!field.name.startsWith("__"))
        fieldNames.set(field.offset, name(field.name));
    const recordName = info?.name ?? "record@0x" + marker.toString(16);
    const category: NodeCategory =
      info?.name === "function"
        ? "function"
        : recordName.startsWith("env:")
          ? "environment"
          : "record";
    const result = {
      size,
      references,
      generals,
      fieldNames,
      type: typeId(recordName, category),
    };
    records.set(marker, result);
    return result;
  };

  // Objects, in address order (old prefix, then nursery).
  const addresses = new GrowableF64(1 << 16),
    sizes = new Growable(1 << 16),
    typesOf = new Growable(1 << 16),
    markers = new GrowableF64(1 << 16);
  const stats: GraphStats = {
    objects: 0,
    bytes: 0,
    oldBytes: 0,
    youngBytes: 0,
    headerBytes: 0,
    edges: 0,
    imageReferences: 0,
    danglingReferences: 0,
    rootReferences: 0,
    rootWalk: "",
    pendingBytes: 0,
  };
  const spaces = [
    { region: dump.old, top: state.oldTop, first: 0 },
    {
      region: dump.young,
      top: state.youngTop,
      first: state.oldCapacity / granule,
    },
  ];
  const registers = meta.thread.registers,
    pending =
      meta.pending ??
      (/__tint_allocation_sample$|allocation-sample-hook$/.test(
        meta.thread.frames[0]?.function ?? "",
      ) &&
      registers.x0 !== undefined &&
      registers.x1 !== undefined
        ? { address: registers.x0, size: registers.x1 }
        : undefined) ??
      undefined;
  for (const space of spaces) {
    const units = Math.floor(space.top / granule);
    let end = 0;
    for (let unit = 0; unit < units;) {
      const bit = space.first + unit,
        byte = dump.starts[bit >>> 3] ?? 0;
      if (byte === 0 && (bit & 7) === 0) {
        unit += 8;
        continue;
      }
      if (((byte >>> (bit & 7)) & 1) === 0) {
        unit++;
        continue;
      }
      const offset = unit * granule,
        address = space.region.base + offset;
      if (offset < end)
        throw Error("object 0x" + address.toString(16) + " overlaps");
      if (pending !== undefined && address === pending.address) {
        // Allocated but not yet initialized (stopped at the sample hook).
        const extent = Math.ceil(pending.size / granule) * granule;
        end = offset + extent;
        stats.pendingBytes += extent;
        unit += extent / granule;
        continue;
      }
      const { marker, flags } = splitHeader(
        wordAt(space.region.bytes, offset),
        descriptor.flagsShift,
      );
      let size: number, type: number;
      if (marker !== 0 && marker <= maxKind) {
        const kind = kinds.get(marker * 8 + flags);
        if (kind === undefined)
          throw Error(
            "unknown kind " +
              marker +
              "/" +
              flags +
              " at 0x" +
              address.toString(16),
          );
        const entry = descriptor.kinds[kind.index];
        if (entry === undefined) throw Error("kind table invariant");
        const count =
          entry.countOffset === null
            ? 0
            : wordAt(space.region.bytes, offset + entry.countOffset);
        size =
          entry.fixedBytes +
          Math.max(count, entry.minimumCount) * entry.elementBytes;
        type = kind.type;
      } else if (marker !== 0 && marker % 8 === 0 && flags === 0) {
        const info = recordInfo(marker);
        size = info.size;
        type = info.type;
      } else
        throw Error(
          "invalid header 0x" +
            marker.toString(16) +
            " at 0x" +
            address.toString(16),
        );
      size = Math.ceil(size / granule) * granule;
      if (offset + size > space.top)
        throw Error("object 0x" + address.toString(16) + " passes its top");
      end = offset + size;
      addresses.push(address);
      sizes.push(size);
      typesOf.push(type);
      markers.push(marker);
      stats.objects++;
      stats.bytes += size;
      stats.headerBytes += headerBytes;
      if (space.region === dump.old) stats.oldBytes += size;
      else stats.youngBytes += size;
      unit += size / granule;
    }
  }
  const address = addresses.finish(),
    size = sizes.finish(),
    type = typesOf.finish(),
    marker = markers.finish(),
    count = address.length;
  const find = (target: number): number => {
    let low = 0,
      high = count;
    while (low < high) {
      const middle = (low + high) >>> 1,
        value = address[middle] ?? 0;
      if (value === target) return middle;
      if (value < target) low = middle + 1;
      else high = middle;
    }
    return -1;
  };

  // Edges, in node order (CSR).
  const edgeStart = new Uint32Array(count + 1),
    targets = new Growable(1 << 16),
    edgeNames = new Growable(1 << 16),
    edgeTypes = new Growable(1 << 16);
  const reference = (
    value: number,
    edgeType: number,
    edgeName: number,
  ): void => {
    if (value === 0) return;
    const node = find(value);
    if (node < 0) {
      if (dump.inImage(value)) stats.imageReferences++;
      else stats.danglingReferences++;
      return;
    }
    targets.push(node);
    edgeNames.push(edgeName);
    edgeTypes.push(edgeType);
  };
  const tags = 0xe8; // string, object, symbol, bigint payloads
  const general = (slot: number, edgeType: number, edgeName: number): void => {
    const tag = dump.read(slot) ?? 0;
    if (tag < 8 && ((tags >>> tag) & 1) !== 0)
      reference(dump.read(slot + 8) ?? 0, edgeType, edgeName);
  };
  for (let node = 0; node < count; node++) {
    edgeStart[node] = targets.length;
    const at = address[node] ?? 0,
      objectMarker = marker[node] ?? 0,
      heap = dump.heapBytes(at);
    if (heap === undefined) throw Error("graph region invariant");
    const word = (offset: number): number =>
      wordAt(heap.bytes, heap.offset + offset);
    if (objectMarker > maxKind) {
      const info = recordInfo(objectMarker);
      for (const offset of info.references)
        reference(
          word(offset),
          edgeProperty,
          info.fieldNames.get(offset) ?? name("@" + offset),
        );
      for (const offset of info.generals)
        general(
          at + offset,
          edgeProperty,
          info.fieldNames.get(offset) ?? name("@" + offset),
        );
      continue;
    }
    const flags = splitHeader(word(0), descriptor.flagsShift).flags,
      kind = kinds.get(objectMarker * 8 + flags),
      entry = kind === undefined ? undefined : descriptor.kinds[kind.index];
    if (entry === undefined) continue;
    if (entry.edges === 1) {
      const capacity = entry.countOffset === null ? 0 : word(entry.countOffset);
      for (let index = 0; index < capacity; index++) {
        const value = word(entry.referenceOffset + index * 8);
        // The vector itself marks a present undefined element.
        if (value !== at) reference(value, edgeElement, index);
      }
    } else if (entry.edges === 2)
      reference(word(entry.referenceOffset), edgeInternal, name("owner"));
    else if (entry.edges === 3) {
      general(at + entry.referenceOffset, edgeWeak, name("key"));
      general(at + entry.referenceOffset + 16, edgeWeak, name("value"));
    }
  }
  edgeStart[count] = targets.length;
  stats.edges = targets.length;

  // Stack roots: the runtime's own safepoint-map walk.
  const frames = new Map<number, RootFrame>(),
    frameOrder: RootFrame[] = [];
  const frameNamed = (fp: number): RootFrame => {
    const known = frames.get(fp);
    if (known !== undefined) return known;
    const described = meta.thread.frames.filter((frame) => frame.fp === fp);
    const label =
      described.length === 0
        ? "frame 0x" + fp.toString(16)
        : described
            .map(
              (frame) =>
                frame.function +
                (frame.file === null
                  ? ""
                  : " (" +
                    frame.file.split("/").pop() +
                    ":" +
                    frame.line +
                    ")"),
            )
            .join(" ← ");
    const frame: RootFrame = { name: label, fp, roots: [] };
    frames.set(fp, frame);
    frameOrder.push(frame);
    return frame;
  };
  let registry = descriptor.registry;
  const walk = meta.walk;
  if (walk.kind === "sample") {
    // A synthetic registry whose walk starts at a frame record returning
    // into the (transparent) sampling thunk, with x19..x28 as stopped.
    const fake = 0x10000,
      frame = 0x20000,
      block = 0x30000,
      entries = dump.read(registry) ?? 0;
    dump.synthetic.set(fake, entries);
    dump.synthetic.set(fake + 8, dump.read(registry + 8) ?? 0);
    dump.synthetic.set(fake + 16, frame);
    dump.synthetic.set(fake + 24, block);
    for (let offset = 32; offset < 32 + entries * 24; offset += 8)
      dump.synthetic.set(fake + offset, dump.read(registry + offset) ?? 0);
    dump.synthetic.set(frame, walk.start);
    dump.synthetic.set(frame + 8, walk.returnAddress ?? 0);
    (walk.saves ?? []).forEach((value, index) =>
      dump.synthetic.set(block + index * 8, value),
    );
    registry = fake;
  }
  let currentFrame: RootFrame | undefined;
  const root = (slot: number, edgeName: string): void => {
    const value = dump.read(slot) ?? 0;
    if (value === 0 || currentFrame === undefined) return;
    const node = find(value);
    if (node < 0) {
      if (dump.inImage(value)) stats.imageReferences++;
      else stats.danglingReferences++;
      return;
    }
    currentFrame.roots.push(name(edgeName), node);
    stats.rootReferences++;
  };
  // The walk reports exact root words, not frames: a word belongs to the
  // frame with the smallest frame pointer at or above it (a frame's slots
  // and its callees' save slots for its registers lie below its record).
  const framePointers = [
    ...new Set(meta.thread.frames.map((frame) => frame.fp)),
  ]
    .filter((fp) => fp > 0)
    .sort((left, right) => left - right);
  const frameOf = (word: number): number => {
    let low = 0,
      high = framePointers.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((framePointers[middle] ?? 0) < word) low = middle + 1;
      else high = middle;
    }
    return framePointers[low] ?? 0;
  };
  const rootWord = (slot: number): void => {
    const fp = frameOf(slot);
    currentFrame = frameNamed(fp);
    root(slot, fp === 0 ? "slot" : "fp-" + (fp - slot));
  };
  const status = walkNativeStack(
    dump.read,
    registry,
    (slot) => {
      rootWord(slot);
      return true;
    },
    (tagWord) => {
      const tag = dump.read(tagWord) ?? 0;
      if (tag < 8 && ((tags >>> tag) & 1) !== 0) rootWord(tagWord + 8);
      return true;
    },
    1000000,
  );
  stats.rootWalk = status;
  if (status !== "complete") throw Error("stack root walk failed: " + status);
  return {
    dump,
    id: (object) => ((address[object] ?? 0) / granule) * 2 + 1,
    label: (object, limit) =>
      types[type[object] ?? 0]?.category === "string"
        ? dump.stringText(address[object] ?? 0, limit)
        : undefined,
    timeSeconds: meta.time,
    count,
    address,
    size,
    type,
    types,
    edgeStart,
    edgeTarget: targets.finish(),
    edgeName: edgeNames.finish(),
    edgeType: new Uint8Array(edgeTypes.finish()),
    names,
    frames: frameOrder,
    stats,
  };
}

/** The Tint-specific totals of a heap report. */
export function reportTotals(graph: TintHeapGraph): ReportTotals {
  return {
    headerBytes: graph.stats.headerBytes,
    oldBytes: graph.stats.oldBytes,
    youngBytes: graph.stats.youngBytes,
    imageReferences: graph.stats.imageReferences,
  };
}
