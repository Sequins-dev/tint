import { readFloat, writeFloat } from "./bytes.ts";

/** Native DataView backing record: distinct layout from Uint8Array while sharing
 * live bytes (and owner buffer identity) with ArrayBuffer / SharedArrayBuffer. */
export interface NativeDataViewBox {
  readonly bytes: Uint8Array;
}

export function dataViewCreate(bytes: Uint8Array): NativeDataViewBox {
  return { bytes };
}

export function dataViewBytes(view: NativeDataViewBox): Uint8Array {
  return view.bytes;
}

function checkOffset(
  bytes: Uint8Array,
  rawOffset: number,
  width: number,
): number {
  let index = Math.trunc(rawOffset);
  if (index !== index) index = 0;
  if (index < 0 || index > 9007199254740991)
    throw new RangeError("Offset is outside the bounds of the DataView");
  if (index > bytes.length || width > bytes.length - index)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return index;
}

function byteAt(bytes: Uint8Array, index: number): number {
  const b = bytes[index];
  if (b === undefined)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return b;
}

export function dataViewGetInt8(
  view: NativeDataViewBox,
  byteOffset: number,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  const b = byteAt(bytes, offset);
  return b >= 128 ? b - 256 : b;
}

export function dataViewGetUint8(
  view: NativeDataViewBox,
  byteOffset: number,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  return byteAt(bytes, offset);
}

export function dataViewGetInt16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const u = dataViewGetUint16(view, byteOffset, littleEndian);
  return u >= 32768 ? u - 65536 : u;
}

export function dataViewGetUint16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const b0 = byteAt(bytes, offset),
    b1 = byteAt(bytes, offset + 1);
  return littleEndian ? b0 + b1 * 256 : b0 * 256 + b1;
}

export function dataViewGetInt32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const u = dataViewGetUint32(view, byteOffset, littleEndian);
  return u >= 2147483648 ? u - 4294967296 : u;
}

export function dataViewGetUint32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const b0 = byteAt(bytes, offset),
    b1 = byteAt(bytes, offset + 1),
    b2 = byteAt(bytes, offset + 2),
    b3 = byteAt(bytes, offset + 3);
  return littleEndian
    ? b0 + b1 * 256 + b2 * 65536 + b3 * 16777216
    : b3 + b2 * 256 + b1 * 65536 + b0 * 16777216;
}

export function dataViewGetFloat16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const decoded = readFloat(bytes, offset, 2, littleEndian ? "little" : "big");
  if (!decoded.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return decoded.value;
}

export function dataViewGetFloat32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const decoded = readFloat(bytes, offset, 4, littleEndian ? "little" : "big");
  if (!decoded.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return decoded.value;
}

export function dataViewGetFloat64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const decoded = readFloat(bytes, offset, 8, littleEndian ? "little" : "big");
  if (!decoded.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return decoded.value;
}

export function dataViewGetBigUint64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): bigint {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const first = dataViewGetUint32(view, offset, littleEndian),
    second = dataViewGetUint32(view, offset + 4, littleEndian);
  const lo = littleEndian ? first : second,
    hi = littleEndian ? second : first;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function dataViewGetBigInt64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): bigint {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const first = dataViewGetUint32(view, offset, littleEndian),
    second = dataViewGetUint32(view, offset + 4, littleEndian);
  const lo = littleEndian ? first : second,
    hiUnsigned = littleEndian ? second : first;
  const hi = hiUnsigned >= 2147483648 ? hiUnsigned - 4294967296 : hiUnsigned;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function dataViewSetInt8(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
): void {
  dataViewSetUint8(view, byteOffset, value);
}

export function dataViewSetUint8(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  bytes[offset] = value & 0xff;
}

export function dataViewSetInt16(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  dataViewSetUint16(view, byteOffset, value, littleEndian);
}

export function dataViewSetUint16(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const bits = value & 0xffff;
  const lo = bits & 0xff,
    hi = (bits >>> 8) & 0xff;
  if (littleEndian) {
    bytes[offset] = lo;
    bytes[offset + 1] = hi;
  } else {
    bytes[offset] = hi;
    bytes[offset + 1] = lo;
  }
}

export function dataViewSetInt32(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  dataViewSetUint32(view, byteOffset, value, littleEndian);
}

export function dataViewSetUint32(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const bits = value >>> 0;
  const b0 = bits & 0xff,
    b1 = (bits >>> 8) & 0xff,
    b2 = (bits >>> 16) & 0xff,
    b3 = (bits >>> 24) & 0xff;
  if (littleEndian) {
    bytes[offset] = b0;
    bytes[offset + 1] = b1;
    bytes[offset + 2] = b2;
    bytes[offset + 3] = b3;
  } else {
    bytes[offset] = b3;
    bytes[offset + 1] = b2;
    bytes[offset + 2] = b1;
    bytes[offset + 3] = b0;
  }
}

export function dataViewSetFloat16(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const written = writeFloat(
    bytes,
    offset,
    2,
    value,
    littleEndian ? "little" : "big",
  );
  if (!written.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
}

export function dataViewSetFloat32(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const written = writeFloat(
    bytes,
    offset,
    4,
    value,
    littleEndian ? "little" : "big",
  );
  if (!written.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
}

export function dataViewSetFloat64(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const written = writeFloat(
    bytes,
    offset,
    8,
    value,
    littleEndian ? "little" : "big",
  );
  if (!written.ok)
    throw new RangeError("Offset is outside the bounds of the DataView");
}

export function dataViewSetBigUint64(
  view: NativeDataViewBox,
  byteOffset: number,
  value: bigint,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const scratch = new BigUint64Array(1);
  scratch[0] = value;
  const raw = new Uint8Array(scratch.buffer);
  for (let i = 0; i < 8; i++) {
    const b = raw[littleEndian ? i : 7 - i];
    if (b === undefined) throw "DATA_VIEW_BIGINT_INVARIANT";
    bytes[offset + i] = b;
  }
}

export function dataViewSetBigInt64(
  view: NativeDataViewBox,
  byteOffset: number,
  value: bigint,
  littleEndian: boolean = false,
): void {
  dataViewSetBigUint64(view, byteOffset, value, littleEndian);
}
