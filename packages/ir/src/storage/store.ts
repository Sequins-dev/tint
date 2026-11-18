import type { FunctionIR } from "../scalar/model.ts";
import { createByteWriter, writtenBytes, type ByteWriter } from "./bytes.ts";
import {
  createPackedVocabulary,
  decodeFunction,
  encodeFunction,
  type PackedVocabulary,
} from "./codec.ts";
/** Where packed chunks go when the memory budget is exceeded. Segments are
 * written once and read whole (docs/compiler-memory.md, "Spill backend"). */
export interface SpillBackend {
  /** Stores `bytes` and returns a segment handle. */
  readonly write: (bytes: Uint8Array) => number;
  readonly read: (segment: number) => Uint8Array;
  /** The segment holds no live function records any more. */
  readonly release: (segment: number) => void;
  readonly close: () => void;
}
/** `memory` never spills; `budget` spills sealed chunks beyond
 * `packedBytes`; `all` packs, releases and spills every body as soon as it
 * is stored (the identity tests and fault finding). */
export type SpillPolicy = "memory" | "budget" | "all";
export interface FunctionStoreOptions {
  readonly policy: SpillPolicy;
  /** Estimated bytes of decoded bodies the store keeps reachable. */
  readonly residentBytes: number;
  /** Bytes of packed chunks kept in memory before spilling. */
  readonly packedBytes: number;
  /** Size at which the open chunk is sealed. */
  readonly chunkBytes: number;
  readonly backend: SpillBackend | undefined;
}
export interface FunctionStoreStatistics {
  /** Bodies encoded / decoded. */
  packed: number;
  decoded: number;
  /** Chunks written to and read from the backend, with their bytes. */
  spilledChunks: number;
  spilledBytes: number;
  reloadedChunks: number;
  reloadedBytes: number;
  /** Live chunks rewritten to drop superseded records. */
  compactions: number;
  /** High-water marks of packed bytes in memory and estimated resident
   * bytes. */
  peakPackedBytes: number;
  peakResidentBytes: number;
}
interface Chunk {
  /** Present while the chunk is in memory (open, sealed or reloaded). */
  bytes: Uint8Array | undefined;
  segment: number | undefined;
  readonly byteLength: number;
  liveBytes: number;
  liveRecords: number;
}
interface Entry {
  resident: FunctionIR | undefined;
  /** The chunk holding the current packed record. */
  chunk: number;
  offset: number;
  byteLength: number;
  /** Position in the resident queue while resident. */
  queued: boolean;
}
/** Decoded bodies cost roughly this many bytes per packed byte (object
 * headers, arrays and boxed fields; measured ~8-12x on compiler IR). */
const residentExpansion = 10;
/** Per-function IR bodies in memory, packed or spilled
 * (docs/compiler-memory.md, "Function store"). Bodies are immutable: a
 * writer replaces a body with `put`, so the packed record is always current
 * and releasing the decoded object loses nothing. */
export interface FunctionStore {
  readonly count: () => number;
  /** Stores (and packs) `fn` under `fn.id`, replacing any earlier body. */
  readonly put: (fn: FunctionIR) => void;
  /** The body of `id`, decoded and reloaded when needed. */
  readonly get: (id: number) => FunctionIR;
  /** Drops the store's reference to the decoded body of `id`. */
  readonly release: (id: number) => void;
  readonly has: (id: number) => boolean;
  /** Releases every decoded body. */
  readonly releaseAll: () => void;
  readonly statistics: () => FunctionStoreStatistics;
  /** Releases every chunk and closes the backend. */
  readonly close: () => void;
}
export function createFunctionStore(
  options: FunctionStoreOptions,
): FunctionStore {
  const policy = options.policy,
    backend = options.backend;
  if (policy !== "memory" && backend === undefined)
    throw "function store spilling requires a backend";
  const vocabulary: PackedVocabulary = createPackedVocabulary();
  const entries: (Entry | undefined)[] = [];
  const chunks: Chunk[] = [];
  let open: ByteWriter = createByteWriter(options.chunkBytes);
  let openChunk = -1;
  // Resident queue (least recently stored or loaded first).
  const queue: number[] = [];
  let queueHead = 0,
    residentBytes = 0,
    packedInMemory = 0,
    closed = false;
  const statistics: FunctionStoreStatistics = {
    packed: 0,
    decoded: 0,
    spilledChunks: 0,
    spilledBytes: 0,
    reloadedChunks: 0,
    reloadedBytes: 0,
    compactions: 0,
    peakPackedBytes: 0,
    peakResidentBytes: 0,
  };
  function startChunk(): void {
    open = createByteWriter(options.chunkBytes);
    notePacked(open.bytes.length);
    openChunk = chunks.length;
    chunks.push({
      bytes: undefined,
      segment: undefined,
      byteLength: 0,
      liveBytes: 0,
      liveRecords: 0,
    });
  }
  startChunk();
  function notePacked(delta: number): void {
    packedInMemory += delta;
    if (packedInMemory > statistics.peakPackedBytes)
      statistics.peakPackedBytes = packedInMemory;
  }
  /** Seals the open chunk (its bytes become immutable) and starts another. */
  function seal(): void {
    if (open.length === 0) return;
    const capacity = open.bytes.length,
      bytes = writtenBytes(open),
      previous = chunks[openChunk];
    if (previous === undefined) throw "function store chunk invariant";
    chunks[openChunk] = {
      bytes,
      segment: undefined,
      byteLength: bytes.length,
      liveBytes: previous.liveBytes,
      liveRecords: previous.liveRecords,
    };
    // The open writer's capacity was counted while it grew; count the
    // sealed copy instead.
    notePacked(bytes.length - capacity);
    startChunk();
    if (policy === "all") spillAll();
    else if (policy === "budget" && packedInMemory > options.packedBytes)
      spillOldest();
  }
  function spillChunk(index: number): void {
    const chunk = chunks[index],
      bytes = chunk === undefined ? undefined : chunk.bytes;
    if (chunk === undefined || bytes === undefined || index === openChunk)
      return;
    if (backend === undefined) throw "function store backend invariant";
    if (chunk.liveRecords === 0) {
      chunk.bytes = undefined;
      notePacked(-bytes.length);
      return;
    }
    if (chunk.segment === undefined) {
      chunk.segment = backend.write(bytes);
      statistics.spilledChunks++;
      statistics.spilledBytes += bytes.length;
    }
    chunk.bytes = undefined;
    notePacked(-bytes.length);
  }
  function spillAll(): void {
    for (let index = 0; index < chunks.length; index++) spillChunk(index);
  }
  function spillOldest(): void {
    for (
      let index = 0;
      index < chunks.length && packedInMemory > options.packedBytes;
      index++
    )
      spillChunk(index);
  }
  function retire(entry: Entry): void {
    const chunk = chunks[entry.chunk];
    if (chunk === undefined) throw "function store chunk invariant";
    chunk.liveBytes -= entry.byteLength;
    chunk.liveRecords--;
    if (chunk.liveRecords === 0 && entry.chunk !== openChunk) {
      const bytes = chunk.bytes;
      if (bytes !== undefined) notePacked(-bytes.length);
      chunk.bytes = undefined;
      const segment = chunk.segment;
      if (segment !== undefined && backend !== undefined)
        backend.release(segment);
      chunk.segment = undefined;
    }
  }
  function residentCost(entry: Entry): number {
    return entry.byteLength * residentExpansion;
  }
  function makeResident(id: number, entry: Entry, fn: FunctionIR): void {
    if (entry.resident === undefined) {
      residentBytes += residentCost(entry);
      if (residentBytes > statistics.peakResidentBytes)
        statistics.peakResidentBytes = residentBytes;
    }
    entry.resident = fn;
    if (!entry.queued) {
      entry.queued = true;
      queue.push(id);
    }
    evict(id);
  }
  function drop(entry: Entry): void {
    if (entry.resident === undefined) return;
    residentBytes -= residentCost(entry);
    entry.resident = undefined;
  }
  /** Releases least recently used bodies (other than `keep`) beyond the
   * resident budget. */
  function evict(keep: number): void {
    const limit = policy === "all" ? 0 : options.residentBytes;
    while (residentBytes > limit && queueHead < queue.length) {
      const id = queue[queueHead] ?? -1;
      queueHead++;
      const entry = entries[id];
      if (entry === undefined) continue;
      entry.queued = false;
      if (id === keep) {
        // Still in use: requeue behind the others.
        entry.queued = true;
        queue.push(id);
        if (queue.length - queueHead <= 1) break;
        continue;
      }
      drop(entry);
    }
    if (queueHead > 4096 && queueHead * 2 > queue.length) {
      queue.splice(0, queueHead);
      queueHead = 0;
    }
  }
  function chunkBytes(index: number): Uint8Array {
    if (index === openChunk) return open.bytes;
    const chunk = chunks[index];
    if (chunk === undefined) throw "function store chunk invariant";
    const bytes = chunk.bytes;
    if (bytes !== undefined) return bytes;
    const segment = chunk.segment;
    if (segment === undefined || backend === undefined)
      throw "function store segment invariant";
    const loaded = backend.read(segment);
    if (loaded.length !== chunk.byteLength)
      throw "function store segment length";
    statistics.reloadedChunks++;
    statistics.reloadedBytes += loaded.length;
    chunk.bytes = loaded;
    notePacked(loaded.length);
    // A reloaded chunk is a cache: keep only the most recent beyond budget.
    if (policy === "all") {
      for (let other = 0; other < chunks.length; other++)
        if (other !== index) spillChunk(other);
    } else if (packedInMemory > options.packedBytes)
      for (
        let other = 0;
        other < chunks.length && packedInMemory > options.packedBytes;
        other++
      )
        if (other !== index) spillChunk(other);
    return loaded;
  }
  /** Rewrites the live records of mostly superseded in-memory chunks into
   * the open chunk, so replaced bodies do not accumulate. */
  function compact(): void {
    const selected = new Uint8Array(chunks.length);
    let any = false;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (
        chunk !== undefined &&
        index !== openChunk &&
        chunk.bytes !== undefined &&
        chunk.liveRecords > 0 &&
        chunk.liveBytes * 2 <= chunk.byteLength
      ) {
        selected[index] = 1;
        any = true;
      }
    }
    if (!any) return;
    for (let id = 0; id < entries.length; id++) {
      const entry = entries[id];
      if (entry === undefined || selected[entry.chunk] !== 1) continue;
      const chunk = chunks[entry.chunk],
        source = chunk === undefined ? undefined : chunk.bytes;
      if (chunk === undefined || source === undefined)
        throw "function store compaction invariant";
      const start = open.length;
      appendRecord(source, entry.offset, entry.byteLength);
      chunk.liveBytes -= entry.byteLength;
      chunk.liveRecords--;
      const target = chunks[openChunk];
      if (target === undefined) throw "function store chunk invariant";
      target.liveBytes += entry.byteLength;
      target.liveRecords++;
      entry.chunk = openChunk;
      entry.offset = start;
      if (open.length >= options.chunkBytes) seal();
    }
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (selected[index] !== 1 || chunk === undefined) continue;
      const bytes = chunk.bytes;
      if (bytes !== undefined) notePacked(-bytes.length);
      chunk.bytes = undefined;
      const segment = chunk.segment;
      if (segment !== undefined && backend !== undefined)
        backend.release(segment);
      chunk.segment = undefined;
      statistics.compactions++;
    }
  }
  function appendRecord(
    source: Uint8Array,
    offset: number,
    length: number,
  ): void {
    const before = open.bytes.length;
    if (open.length + length > open.bytes.length) {
      let capacity = open.bytes.length * 2;
      while (capacity < open.length + length) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(open.bytes.subarray(0, open.length));
      open.bytes = grown;
    }
    open.bytes.set(source.subarray(offset, offset + length), open.length);
    open.length += length;
    notePacked(open.bytes.length - before);
  }
  let sinceCompaction = 0;
  function put(fn: FunctionIR): void {
    if (closed) throw "function store is closed";
    const id = fn.id;
    if (!Number.isSafeInteger(id) || id < 0) throw "function store id";
    while (entries.length <= id) entries.push(undefined);
    const before = open.bytes.length,
      start = open.length;
    encodeFunction(open, vocabulary, fn);
    notePacked(open.bytes.length - before);
    statistics.packed++;
    const length = open.length - start;
    const target = chunks[openChunk];
    if (target === undefined) throw "function store chunk invariant";
    target.liveBytes += length;
    target.liveRecords++;
    let entry = entries[id];
    if (entry === undefined) {
      entry = {
        resident: undefined,
        chunk: openChunk,
        offset: start,
        byteLength: length,
        queued: false,
      };
      entries[id] = entry;
    } else {
      retire(entry);
      drop(entry);
      entry.chunk = openChunk;
      entry.offset = start;
      entry.byteLength = length;
      sinceCompaction += length;
    }
    // Under `all` nothing stays decoded: every get decodes, and every
    // sealed chunk is read back from the backend.
    if (policy !== "all") makeResident(id, entry, fn);
    if (open.length >= options.chunkBytes) seal();
    if (sinceCompaction > options.chunkBytes * 4) {
      sinceCompaction = 0;
      compact();
    }
  }
  function get(id: number): FunctionIR {
    const entry = entries[id];
    if (entry === undefined) throw "function store has no body " + String(id);
    const resident = entry.resident;
    if (resident !== undefined) return resident;
    const bytes = chunkBytes(entry.chunk);
    const fn = decodeFunction(
      bytes,
      entry.offset,
      entry.offset + entry.byteLength,
      vocabulary,
    );
    statistics.decoded++;
    if (policy !== "all") makeResident(id, entry, fn);
    return fn;
  }
  function release(id: number): void {
    const entry = entries[id];
    if (entry !== undefined) drop(entry);
  }
  return {
    count: () => entries.length,
    put,
    get,
    release,
    has: (id: number): boolean => entries[id] !== undefined,
    releaseAll: (): void => {
      for (const entry of entries) if (entry !== undefined) drop(entry);
    },
    statistics: (): FunctionStoreStatistics => ({ ...statistics }),
    close: (): void => {
      if (closed) return;
      closed = true;
      for (const chunk of chunks) {
        if (chunk === undefined) continue;
        const segment = chunk.segment;
        if (segment !== undefined && backend !== undefined)
          backend.release(segment);
        chunk.segment = undefined;
        chunk.bytes = undefined;
      }
      for (const entry of entries) if (entry !== undefined) drop(entry);
      if (backend !== undefined) backend.close();
    },
  };
}
/** A backend that keeps segments in memory (tests and hosts without files). */
export function createMemorySpillBackend(): SpillBackend {
  const segments = new Map<number, Uint8Array>();
  let next = 0;
  return {
    write: (bytes: Uint8Array): number => {
      const segment = next;
      next++;
      segments.set(segment, bytes.slice());
      return segment;
    },
    read: (segment: number): Uint8Array => {
      const bytes = segments.get(segment);
      if (bytes === undefined) throw "memory spill segment missing";
      return bytes.slice();
    },
    release: (segment: number): void => {
      segments.delete(segment);
    },
    close: (): void => {
      segments.clear();
    },
  };
}
