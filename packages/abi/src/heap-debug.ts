import {
  nativeBuiltinMarkerLimit,
  nativeHeaderByteLength,
  nativeHeaderFlagsShift,
} from "./host.ts";
import { nativeTypedArrayKinds } from "./typed-array.ts";
/** Heap debugger descriptor: the exported `__tint_heap_descriptor` data
 * symbol of images built with heap introspection (see
 * docs/native-heap-profiling.md). In the spirit of `__jit_debug_descriptor`,
 * it lets external tools (LLDB scripts, core-dump readers, samplers) find
 * and decode the managed heap without private knowledge of the runtime:
 * every fact a heap walk needs is either a constant stored here or a live
 * word this descriptor locates. Default images do not contain it.
 *
 * All words are little-endian. Offsets are bytes from the descriptor start.
 * Tools must check the magic and version, and must reject a version they do
 * not know: a later layout (header shape, collector structure, reference
 * encoding) changes the version rather than reinterpreting these fields.
 *
 * Live heap state is not copied here. The descriptor names the main hosted
 * context, and the context's existing words (written by the runtime with
 * plain stores at allocation and collection) hold the dynamic state: managed
 * region bounds, the allocation/collector state block (young and old tops,
 * active half, object-start bitmap, dirty cards) and the stack-map registry
 * whose frames are the heap's only roots. Collections therefore cost nothing
 * extra to keep it current. The state is consistent outside a collection:
 * at any safepoint, including `__tint_allocation_sample`. */
export const heapDebugSymbol = "__tint_heap_descriptor";
/** The exported no-op hook allocation sampling calls (see below). */
export const heapDebugSampleSymbol = "__tint_allocation_sample";
/** The sampling thunk standing in for the allocation slow path. Its frame
 * (transparent to stack maps) returns into the allocating managed frame,
 * which is at its allocation safepoint: tools start precise root walks
 * there while it is on the stack. */
export const heapDebugSampleThunkSymbol = "__tint_allocation_sample_thunk";
/** "TINTHEAP" as two little-endian words. */
export const heapDebugMagicLow = 0x544e4954;
export const heapDebugMagicHigh = 0x50414548;
/** Version 3: one-word headers (marker and kind flags in one word), the
 * 8-byte granule, per-kind minimum element counts, and a nursery without
 * start bits (walked by object extents; see the state block below). */
export const heapDebugVersion = 3;

// Header and live words (u64 unless noted).
export const heapDebugMagicOffset = 0;
/** u32 version, then u32 descriptor byte length. */
export const heapDebugVersionOffset = 8;
export const heapDebugByteLengthOffset = 12;
/** Address of the main thread's hosted context while managed code runs,
 * else 0 (before startup publishes it and after teardown). */
export const heapDebugContextOffset = 16;
/** Allocation sampling, written by tools: the sampling interval in bytes
 * (0: disarmed) and the young allocation limit to restore (the nursery
 * capacity the runtime published). Arming stores the saved limit and the
 * interval here and lowers the state block's young limit to
 * min(saved, young top + interval); every allocation that crosses it takes
 * the slow path, whose sampling thunk calls the hook with
 * (address, size, context) after the allocation succeeds, then rearms the
 * limit from the (possibly updated) interval. Disarming stores interval 0
 * and restores the saved limit. Unarmed, generated code and the inline
 * allocation sequence are unchanged and the thunk only forwards. Arming may
 * happen at any instruction, below the top of an allocation in flight: the
 * inline sequence compares top + size with the limit, so the next allocation
 * then takes the slow path (docs/allocation-throughput.md). */
export const heapDebugSampleIntervalOffset = 24;
export const heapDebugSampleLimitOffset = 32;
/** Samples taken (incremented by the thunk). */
export const heapDebugSampleCountOffset = 40;

// Layout facts (u32 each), constant for the image.
/** Bytes of every object header and the allocation granule. */
export const heapDebugHeaderBytesOffset = 48;
export const heapDebugGranuleBytesOffset = 52;
/** The header word's offset in the object, and the bit at which its three
 * kind-flag bits start: the marker (a built-in kind number, or the address
 * of a record descriptor) is the header modulo 2^shift. */
export const heapDebugMarkerOffset = 56;
export const heapDebugFlagsShiftOffset = 60;
/** Markers at or below this are built-in kinds (the kind table); larger
 * markers are record descriptor addresses (multiples of 8). */
export const heapDebugMaxKindMarkerOffset = 64;
/** Record descriptors: object byte length at +0, reference count at +8,
 * then that many object-relative reference offsets, then the general
 * count and general offsets. The descriptor's module-local record index is
 * the word `recordIndexBefore` bytes before it. */
export const heapDebugRecordExtentOffset = 68;
export const heapDebugRecordReferencesOffset = 72;
export const heapDebugRecordIndexBeforeOffset = 76;
/** General (tagged) values: byte size (tag word, then payload word) and the
 * mask of tags whose payload is a managed reference (bit t for tag t). */
export const heapDebugGeneralBytesOffset = 80;
export const heapDebugGeneralReferenceTagsOffset = 84;
/** References are full native addresses (0: none); reference encoding 1. */
export const heapDebugReferenceEncodingOffset = 88;
/** Collector structure (see heapDebugCollector*). */
export const heapDebugCollectorOffset = 92;
/** Hosted context words: stack-map registry, managed region base and byte
 * length, and the allocation/collector state block address. */
export const heapDebugContextRegistryOffset = 96;
export const heapDebugContextManagedBaseOffset = 100;
export const heapDebugContextManagedBytesOffset = 104;
export const heapDebugContextStateOffset = 108;
/** u32 word indices into the state block (generational collector): young
 * top, young limit, young base (offset of the nursery from the managed
 * base), old top, the u64 address of the young object-start bits (the old
 * prefix's bits immediately precede it: bit i says a granule-aligned object
 * starts at old base + i * granule, old base = young base - old capacity),
 * old capacity, the u64 address of the dirty-card bitmap (one bit per
 * granule of the old prefix), and the remembered-queue count. Objects occupy
 * [old base, old base + old top), found through the start bits since
 * parallel evacuation leaves unformatted gaps, and [young base, young base +
 * young top), which is bump-allocated without gaps and keeps no start bits:
 * it is walked object by object from its base by each object's extent. */
export const heapDebugStateYoungTopOffset = 112;
export const heapDebugStateYoungLimitOffset = 116;
export const heapDebugStateYoungBaseOffset = 120;
export const heapDebugStateOldTopOffset = 124;
export const heapDebugStateStartBitsOffset = 128;
export const heapDebugStateOldCapacityOffset = 132;
export const heapDebugStateDirtyBitsOffset = 136;
export const heapDebugStateQueueCountOffset = 140;
/** Kind table: entry count and the offset of the first entry. */
export const heapDebugKindTotalOffset = 144;
export const heapDebugKindTableOffset = 148;
/** Name pool: offset and byte length of NUL-terminated names. */
export const heapDebugNamePoolOffset = 152;
export const heapDebugNamePoolBytesOffset = 156;
export const heapDebugFixedBytes = 160;

/** Collector structures. */
export const heapDebugCollectorGenerational = 2;

/** One kind table entry: u32 words. A header matches when its marker equals
 * `marker` and its kind flags equal `flags`. The extent is
 * align(fixedBytes + max(count, minimumCount) * elementBytes, granule),
 * where count is the word at `countOffset` (none: count 0). Edges: none, every element word a
 * reference (0: hole), the single reference at `referenceOffset`, or two
 * general values (key, value) starting at `referenceOffset` that are weak.
 * `name` is the offset of the kind's DWARF type name in the name pool. */
export const heapDebugKindEntryBytes = 36;
export const heapDebugKindMarker = 0;
export const heapDebugKindFlags = 4;
export const heapDebugKindFixedBytes = 8;
export const heapDebugKindCountField = 12;
export const heapDebugKindElementBytes = 16;
export const heapDebugKindEdges = 20;
export const heapDebugKindReferenceOffset = 24;
export const heapDebugKindName = 28;
export const heapDebugKindMinimumCount = 32;
/** countOffset when the kind has no element count. */
export const heapDebugKindNoCount = 0xffffffff;
export const heapDebugEdgesNone = 0;
export const heapDebugEdgesElements = 1;
export const heapDebugEdgesReference = 2;
export const heapDebugEdgesWeakGenerals = 3;
/** Records are named by DWARF: each record descriptor has a global
 * variable `__tint_record.<module>.<index>` located at the descriptor,
 * whose type is the structure of the objects it describes. */
export const heapDebugRecordVariablePrefix = "__tint_record.";

export interface HeapDebugKind {
  readonly marker: number;
  readonly flags: number;
  readonly fixedBytes: number;
  readonly countOffset: number;
  readonly elementBytes: number;
  readonly edges: number;
  readonly referenceOffset: number;
  /** The kind's DWARF structure name. */
  readonly name: string;
  readonly minimumCount: number;
}
function kind(
  marker: number,
  flags: number,
  fixedBytes: number,
  countOffset: number,
  elementBytes: number,
  edges: number,
  referenceOffset: number,
  name: string,
  minimumCount: number,
): HeapDebugKind {
  return {
    marker,
    flags,
    fixedBytes,
    countOffset: countOffset < 0 ? heapDebugKindNoCount : countOffset,
    elementBytes,
    edges,
    referenceOffset,
    name,
    minimumCount,
  };
}
function builtinKinds(): HeapDebugKind[] {
  // Strings have at least eight data bytes (inline comparisons read them):
  // four two-byte units or eight one-byte units. Both flat kinds share the
  // DWARF `string` structure, whose `units` and `bytes` overlay the data.
  const kinds: HeapDebugKind[] = [
    kind(1, 0, 16, 8, 2, 0, 0, "string", 4),
    kind(1, 1, 16, 8, 1, 0, 0, "string", 8),
    kind(1, 2, 32, -1, 0, 2, 24, "string.slice", 0),
    kind(1, 3, 32, -1, 0, 2, 24, "string.slice", 0),
  ];
  for (const entry of nativeTypedArrayKinds) {
    if (entry === undefined) throw "heap debug typed array invariant";
    const name = entry.name;
    kinds.push(kind(entry.marker, 0, 24, 8, entry.elementBytes, 0, 0, name, 0));
    kinds.push(kind(entry.marker, 1, 24, -1, 0, 0, 0, name + ".external", 0));
    kinds.push(kind(entry.marker, 2, 40, -1, 0, 2, 24, name + ".view", 0));
  }
  kinds.push(kind(6, 0, 24, 8, 8, 1, 24, "vector", 0));
  kinds.push(kind(7, 0, 40, -1, 0, 3, 8, "weak-slot", 0));
  kinds.push(kind(7, 1, 40, -1, 0, 3, 8, "ephemeron-slot", 0));
  return kinds;
}
/** Built-in object kinds of the current header format (marker 1: string,
 * flat in the heap or an image literal, two-byte (flags 0) or one-byte
 * (flags 1), or sliced from a flat parent (flags 2, or 3 for one-byte);
 * typed buffers by element kind (./typed-array.ts), owning (flags 0),
 * borrowing external storage (1) or viewing an owner (2); 6: reference
 * vector; 7: weak slot, weak (0) or ephemeron (1)). Functions are records
 * whose descriptor is the image's function-record descriptor. Offsets follow
 * packages/abi/src/host.ts. */
export const heapDebugKinds: readonly HeapDebugKind[] = builtinKinds();

/** The descriptor's initial image bytes. Startup stores the live context
 * word; tools write the sampling words. */
export function heapDebugDescriptorBytes(): Uint8Array {
  const names: number[] = [],
    nameOffsets: number[] = [];
  for (const entry of heapDebugKinds) {
    if (entry === undefined) throw "heap debug kind invariant";
    nameOffsets.push(names.length);
    for (let i = 0; i < entry.name.length; i++)
      names.push(entry.name.charCodeAt(i) & 0x7f);
    names.push(0);
  }
  const table = heapDebugFixedBytes,
    pool = table + heapDebugKinds.length * heapDebugKindEntryBytes,
    byteLength = Math.ceil((pool + names.length) / 16) * 16,
    bytes = new Uint8Array(byteLength);
  function u32(offset: number, value: number): void {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
    bytes[offset + 2] = (value >>> 16) & 255;
    bytes[offset + 3] = (value >>> 24) & 255;
  }
  u32(heapDebugMagicOffset, heapDebugMagicLow);
  u32(heapDebugMagicOffset + 4, heapDebugMagicHigh);
  u32(heapDebugVersionOffset, heapDebugVersion);
  u32(heapDebugByteLengthOffset, byteLength);
  u32(heapDebugHeaderBytesOffset, nativeHeaderByteLength);
  u32(heapDebugGranuleBytesOffset, 8);
  u32(heapDebugMarkerOffset, 0);
  u32(heapDebugFlagsShiftOffset, nativeHeaderFlagsShift);
  u32(heapDebugMaxKindMarkerOffset, nativeBuiltinMarkerLimit - 1);
  u32(heapDebugRecordExtentOffset, 0);
  u32(heapDebugRecordReferencesOffset, 8);
  u32(heapDebugRecordIndexBeforeOffset, 8);
  u32(heapDebugGeneralBytesOffset, 16);
  // string, object, symbol and bigint payloads are references.
  u32(
    heapDebugGeneralReferenceTagsOffset,
    (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7),
  );
  u32(heapDebugReferenceEncodingOffset, 1);
  u32(heapDebugCollectorOffset, heapDebugCollectorGenerational);
  u32(heapDebugContextRegistryOffset, 0);
  u32(heapDebugContextManagedBaseOffset, 8);
  u32(heapDebugContextManagedBytesOffset, 32);
  u32(heapDebugContextStateOffset, 56);
  u32(heapDebugStateYoungTopOffset, 0);
  u32(heapDebugStateYoungLimitOffset, 1);
  u32(heapDebugStateYoungBaseOffset, 2);
  u32(heapDebugStateOldTopOffset, 3);
  u32(heapDebugStateStartBitsOffset, 4);
  u32(heapDebugStateOldCapacityOffset, 7);
  u32(heapDebugStateDirtyBitsOffset, 8);
  u32(heapDebugStateQueueCountOffset, 12);
  u32(heapDebugKindTotalOffset, heapDebugKinds.length);
  u32(heapDebugKindTableOffset, table);
  u32(heapDebugNamePoolOffset, pool);
  u32(heapDebugNamePoolBytesOffset, names.length);
  for (let index = 0; index < heapDebugKinds.length; index++) {
    const entry = heapDebugKinds[index],
      name = nameOffsets[index];
    if (entry === undefined || name === undefined)
      throw "heap debug kind invariant";
    const at = table + index * heapDebugKindEntryBytes;
    u32(at + heapDebugKindMarker, entry.marker);
    u32(at + heapDebugKindFlags, entry.flags);
    u32(at + heapDebugKindFixedBytes, entry.fixedBytes);
    u32(at + heapDebugKindCountField, entry.countOffset);
    u32(at + heapDebugKindElementBytes, entry.elementBytes);
    u32(at + heapDebugKindEdges, entry.edges);
    u32(at + heapDebugKindReferenceOffset, entry.referenceOffset);
    u32(at + heapDebugKindName, name);
    u32(at + heapDebugKindMinimumCount, entry.minimumCount);
  }
  for (let index = 0; index < names.length; index++)
    bytes[pool + index] = names[index] ?? 0;
  return bytes;
}
