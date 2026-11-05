import { copyByteStorage } from "../bytes/index.ts";
import {
  readSharedUnsigned,
  writeSharedUnsigned,
  readSharedWord64,
  writeSharedWord64,
  type SharedOrder,
} from "../bytes/shared.ts";
import {
  readUnsigned,
  writeUnsigned,
  readWord64,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import type { BufferStorageWindow } from "./buffer-storage.ts";
import {
  typedArrayWindow,
  typedArrayElementWidth,
  type TypedArrayData,
} from "./typed-array-data.ts";

/** Capture one entire aligned element before decoding/boxing. Shared integer
 * elements must never be assembled from independent byte/half-word loads. */
export function readTypedArrayBytes(
  data: TypedArrayData,
  index: number,
  window: BufferStorageWindow,
  order: SharedOrder = "unordered",
): Uint8Array {
  const width = typedArrayElementWidth(data.kind);
  const offset = data.byteOffset + index * width;
  const bytes = new Uint8Array(width);
  const ordinaryBytes = window.bytes;
  if (ordinaryBytes !== undefined) {
    for (let byte = 0; byte < width; byte++) {
      const value = ordinaryBytes[offset + byte];
      if (value === undefined) throw "TYPED_ARRAY_READ_BOUNDS_INVARIANT";
      bytes[byte] = value;
    }
  } else {
    const shared = window.shared;
    if (shared === undefined) throw "TYPED_ARRAY_BACKING_INVARIANT";
    if (width === 8) {
      const word = readSharedWord64(shared, offset, order);
      if (!word.ok || !writeWord64(bytes, 0, word.value, data.endian).ok)
        throw "TYPED_ARRAY_WORD_READ_INVARIANT";
    } else {
      const narrow = width === 1 ? 1 : width === 2 ? 2 : 4;
      const value = readSharedUnsigned(shared, offset, narrow, order);
      if (
        !value.ok ||
        !writeUnsigned(bytes, 0, narrow, value.value, data.endian).ok
      )
        throw "TYPED_ARRAY_UNSIGNED_READ_INVARIANT";
    }
  }
  return bytes;
}
export function writeTypedArrayBytes(
  data: TypedArrayData,
  index: number,
  bytes: Uint8Array,
  window: BufferStorageWindow,
  order: SharedOrder = "unordered",
): void {
  const width = typedArrayElementWidth(data.kind);
  const offset = data.byteOffset + index * width;
  const ordinaryBytes = window.bytes;
  if (ordinaryBytes !== undefined) {
    for (let byte = 0; byte < width; byte++) {
      const value = bytes[byte];
      if (value === undefined) throw "TYPED_ARRAY_WRITE_BYTES_INVARIANT";
      ordinaryBytes[offset + byte] = value;
    }
  } else {
    const shared = window.shared;
    if (shared === undefined) throw "TYPED_ARRAY_BACKING_INVARIANT";
    if (width === 8) {
      const word = readWord64(bytes, 0, data.endian);
      if (
        !word.ok ||
        writeSharedWord64(shared, offset, word.value, order) !== "none"
      )
        throw "TYPED_ARRAY_WORD_WRITE_INVARIANT";
    } else {
      const narrow = width === 1 ? 1 : width === 2 ? 2 : 4;
      const value = readUnsigned(bytes, 0, narrow, data.endian);
      if (
        !value.ok ||
        writeSharedUnsigned(shared, offset, narrow, value.value, order) !==
          "none"
      )
        throw "TYPED_ARRAY_UNSIGNED_WRITE_INVARIANT";
    }
  }
}
/** Same-kind raw copies preserve NaN payloads. Direction is caller policy: slice
 * copies forward; set/copyWithin preserve an overlapping source range. */
export function copyTypedArrayElements(
  source: TypedArrayData,
  target: TypedArrayData,
  sourceStart: number,
  targetStart: number,
  count: number,
  overlapSafe: boolean,
): void {
  const from = typedArrayWindow(source),
    to = typedArrayWindow(target, "write");
  if (from === undefined || to === undefined)
    throw "TYPED_ARRAY_COPY_WINDOW_INVARIANT";
  const width = typedArrayElementWidth(source.kind);
  const sourceStorage = source.storage,
    targetStorage = target.storage;
  if (
    overlapSafe &&
    sourceStorage.kind === "ordinary" &&
    targetStorage.kind === "ordinary"
  ) {
    if (
      copyByteStorage(
        sourceStorage,
        targetStorage,
        source.byteOffset + sourceStart * width,
        target.byteOffset + targetStart * width,
        count * width,
      ) !== "none"
    )
      throw "TYPED_ARRAY_COPY_INVARIANT";
    return;
  }
  const fromBytes = from.bytes,
    toBytes = to.bytes;
  if (!overlapSafe && fromBytes !== undefined && toBytes !== undefined) {
    for (let byte = 0; byte < count * width; byte++) {
      const value = fromBytes[source.byteOffset + sourceStart * width + byte];
      if (value === undefined) throw "TYPED_ARRAY_COPY_BYTE_INVARIANT";
      toBytes[target.byteOffset + targetStart * width + byte] = value;
    }
    return;
  }
  let sameBlock = sourceStorage === targetStorage;
  if (sourceStorage.kind === "shared" && targetStorage.kind === "shared")
    sameBlock =
      sourceStorage.engineId === targetStorage.engineId &&
      sourceStorage.blockId === targetStorage.blockId;
  const sourceOffset = source.byteOffset + sourceStart * width;
  const targetOffset = target.byteOffset + targetStart * width;
  const backwards =
    overlapSafe &&
    sameBlock &&
    targetOffset > sourceOffset &&
    targetOffset - sourceOffset < count * width;
  for (let at = 0; at < count; at++) {
    const index = backwards ? count - at - 1 : at;
    writeTypedArrayBytes(
      target,
      targetStart + index,
      readTypedArrayBytes(source, sourceStart + index, from),
      to,
    );
  }
}
