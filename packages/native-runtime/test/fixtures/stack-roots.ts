import {
  stackMapMagic,
  stackMapVersion,
  stackMapRegistryHeaderBytes,
  stackMapTableHeaderBytes,
} from "../../src/tracing/scan.ts";

/** A simulated managed frame: its stack pointer and the reference and
 * general-value words its safepoint map lists (offsets from sp). */
export interface FakeFrame {
  readonly sp: number;
  readonly references: readonly number[];
  readonly generals?: readonly number[];
}

/** Writes a simulated native stack the collectors walk: the collecting
 * function's frame record just below `frames[0]`, then `frames` (innermost
 * first, contiguous: each frame ends where the next frame's record sits),
 * an entry frame (saved frame pointer 0), and at `metadata` a stack-map
 * registry with one code range and its safepoint table (about 100 bytes plus
 * 8 per listed offset). Returns the registry address, the root head the
 * collectors take. */
export function writeStackRoots(
  set: (address: number, value: number) => void,
  frames: readonly FakeFrame[],
  metadata: number,
): number {
  const count = frames.length,
    code = metadata,
    table = metadata + stackMapRegistryHeaderBytes + 24,
    entries = table + stackMapTableHeaderBytes,
    pointers: number[] = [];
  for (let index = 0; index < count; index++) {
    const frame = frames[index]!,
      next = frames[index + 1];
    let needed = 16;
    for (const offset of frame.references)
      needed = Math.max(needed, offset + 8);
    for (const offset of frame.generals ?? [])
      needed = Math.max(needed, offset + 16);
    const pointer =
      next === undefined
        ? frame.sp + Math.ceil(needed / 16) * 16
        : next.sp - 16;
    if ((pointer - frame.sp) % 16 !== 0 || pointer - frame.sp < needed)
      throw Error("fake frames overlap or are misaligned");
    pointers.push(pointer);
  }
  // Registry: one code range covering every return address.
  [
    count === 0 ? 0 : 1,
    1,
    count === 0 ? 0 : frames[0]!.sp - 16,
    0,
    code,
    8 * (count + 2),
    table,
  ].forEach((value, index) => set(metadata + index * 8, value));
  set(table, stackMapMagic);
  set(table + 8, stackMapVersion);
  set(table + 16, count);
  let map = entries + count * 8;
  for (let index = 0; index < count; index++) {
    const frame = frames[index]!,
      pointer = pointers[index]!,
      generals = frame.generals ?? [];
    // Return offset 4 (index + 1): the call in frame `index`.
    set(
      entries + index * 8,
      ((map - table) / 8) * 4294967296 + 4 * (index + 1),
    );
    [
      pointer - frame.sp,
      frame.references.length,
      ...frame.references,
      generals.length,
      ...generals,
    ].forEach((value, at) => set(map + at * 8, value));
    map += (3 + frame.references.length + generals.length) * 8;
  }
  if (count === 0) return metadata;
  // Records: the collector's frame below frame 0, then each frame's own.
  set(frames[0]!.sp - 16, pointers[0]!);
  set(frames[0]!.sp - 8, code + 4);
  for (let index = 0; index < count; index++) {
    const pointer = pointers[index]!,
      next = pointers[index + 1];
    // The outermost frame's caller is the entry record (saved frame pointer
    // 0) just above it.
    set(pointer, next ?? pointer + 16);
    set(pointer + 8, next === undefined ? 0 : code + 4 * (index + 2));
  }
  const entry = pointers[count - 1]! + 16;
  set(entry, 0);
  set(entry + 8, 0);
  return metadata;
}
