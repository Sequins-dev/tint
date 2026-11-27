interface DataViewScratch {
  readonly u8: Uint8Array;
  readonly f16: Float16Array;
  readonly f32: Float32Array;
  readonly f64: Float64Array;
  readonly hostLittleEndian: boolean;
}

/** Native DataView backing record: distinct layout from Uint8Array while sharing
 * live bytes (and owner buffer identity) with ArrayBuffer / SharedArrayBuffer. */
export interface NativeDataViewBox {
  readonly bytes: Uint8Array;
  scratch: DataViewScratch | undefined;
}

export function dataViewCreate(bytes: Uint8Array): NativeDataViewBox {
  return { bytes, scratch: undefined };
}

export function dataViewBytes(view: NativeDataViewBox): Uint8Array {
  return view.bytes;
}

function initScratch(view: NativeDataViewBox): DataViewScratch {
  const buffer = new ArrayBuffer(8);
  const u8 = new Uint8Array(buffer);
  const probe = new Uint16Array(buffer);
  probe[0] = 0x0102;
  const hostLittleEndian = (u8[0] ?? 0) === 0x02;
  const scratch: DataViewScratch = {
    u8,
    f16: new Float16Array(buffer),
    f32: new Float32Array(buffer),
    f64: new Float64Array(buffer),
    hostLittleEndian,
  };
  view.scratch = scratch;
  return scratch;
}

function checkOffsetSlow(
  length: number,
  rawOffset: number,
  width: number,
): number {
  let index = Math.trunc(rawOffset);
  if (index !== index) index = 0;
  if (index < 0 || index > 9007199254740991)
    throw new RangeError("Offset is outside the bounds of the DataView");
  if (index > length || width > length - index)
    throw new RangeError("Offset is outside the bounds of the DataView");
  return index;
}

function checkOffset(
  bytes: Uint8Array,
  rawOffset: number,
  width: number,
): number {
  const length = bytes.length;
  const fast = rawOffset | 0;
  if (fast === rawOffset && fast >= 0 && width <= length - fast) return fast;
  return checkOffsetSlow(length, rawOffset, width);
}

function loadScratch8(
  u8: Uint8Array,
  bytes: Uint8Array,
  offset: number,
  sameOrder: boolean,
): void {
  if (sameOrder) {
    u8[0] = bytes[offset] ?? 0;
    u8[1] = bytes[offset + 1] ?? 0;
    u8[2] = bytes[offset + 2] ?? 0;
    u8[3] = bytes[offset + 3] ?? 0;
    u8[4] = bytes[offset + 4] ?? 0;
    u8[5] = bytes[offset + 5] ?? 0;
    u8[6] = bytes[offset + 6] ?? 0;
    u8[7] = bytes[offset + 7] ?? 0;
  } else {
    u8[7] = bytes[offset] ?? 0;
    u8[6] = bytes[offset + 1] ?? 0;
    u8[5] = bytes[offset + 2] ?? 0;
    u8[4] = bytes[offset + 3] ?? 0;
    u8[3] = bytes[offset + 4] ?? 0;
    u8[2] = bytes[offset + 5] ?? 0;
    u8[1] = bytes[offset + 6] ?? 0;
    u8[0] = bytes[offset + 7] ?? 0;
  }
}

function storeScratch8(
  bytes: Uint8Array,
  offset: number,
  u8: Uint8Array,
  sameOrder: boolean,
): void {
  if (sameOrder) {
    bytes[offset] = u8[0] ?? 0;
    bytes[offset + 1] = u8[1] ?? 0;
    bytes[offset + 2] = u8[2] ?? 0;
    bytes[offset + 3] = u8[3] ?? 0;
    bytes[offset + 4] = u8[4] ?? 0;
    bytes[offset + 5] = u8[5] ?? 0;
    bytes[offset + 6] = u8[6] ?? 0;
    bytes[offset + 7] = u8[7] ?? 0;
  } else {
    bytes[offset] = u8[7] ?? 0;
    bytes[offset + 1] = u8[6] ?? 0;
    bytes[offset + 2] = u8[5] ?? 0;
    bytes[offset + 3] = u8[4] ?? 0;
    bytes[offset + 4] = u8[3] ?? 0;
    bytes[offset + 5] = u8[2] ?? 0;
    bytes[offset + 6] = u8[1] ?? 0;
    bytes[offset + 7] = u8[0] ?? 0;
  }
}

export function dataViewGetInt8(
  view: NativeDataViewBox,
  byteOffset: number,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  return ((bytes[offset] ?? 0) << 24) >> 24;
}

export function dataViewGetUint8(
  view: NativeDataViewBox,
  byteOffset: number,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  return bytes[offset] ?? 0;
}

export function dataViewGetInt16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const b0 = bytes[offset] ?? 0,
    b1 = bytes[offset + 1] ?? 0;
  const bits = littleEndian ? b0 | (b1 << 8) : (b0 << 8) | b1;
  return (bits << 16) >> 16;
}

export function dataViewGetUint16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const b0 = bytes[offset] ?? 0,
    b1 = bytes[offset + 1] ?? 0;
  return littleEndian ? b0 | (b1 << 8) : (b0 << 8) | b1;
}

export function dataViewGetInt32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const b0 = bytes[offset] ?? 0,
    b1 = bytes[offset + 1] ?? 0,
    b2 = bytes[offset + 2] ?? 0,
    b3 = bytes[offset + 3] ?? 0;
  return littleEndian
    ? b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    : (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
}

export function dataViewGetUint32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const b0 = bytes[offset] ?? 0,
    b1 = bytes[offset + 1] ?? 0,
    b2 = bytes[offset + 2] ?? 0,
    b3 = bytes[offset + 3] ?? 0;
  return (
    (littleEndian
      ? b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
      : (b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0
  );
}

export function dataViewGetFloat16(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 2);
  const scratch = view.scratch ?? initScratch(view);
  const u8 = scratch.u8;
  if (littleEndian === scratch.hostLittleEndian) {
    u8[0] = bytes[offset] ?? 0;
    u8[1] = bytes[offset + 1] ?? 0;
  } else {
    u8[1] = bytes[offset] ?? 0;
    u8[0] = bytes[offset + 1] ?? 0;
  }
  return scratch.f16[0] ?? 0;
}

export function dataViewGetFloat32(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const scratch = view.scratch ?? initScratch(view);
  const u8 = scratch.u8;
  if (littleEndian === scratch.hostLittleEndian) {
    u8[0] = bytes[offset] ?? 0;
    u8[1] = bytes[offset + 1] ?? 0;
    u8[2] = bytes[offset + 2] ?? 0;
    u8[3] = bytes[offset + 3] ?? 0;
  } else {
    u8[3] = bytes[offset] ?? 0;
    u8[2] = bytes[offset + 1] ?? 0;
    u8[1] = bytes[offset + 2] ?? 0;
    u8[0] = bytes[offset + 3] ?? 0;
  }
  return scratch.f32[0] ?? 0;
}

export function dataViewGetFloat64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const scratch = view.scratch ?? initScratch(view);
  loadScratch8(
    scratch.u8,
    bytes,
    offset,
    littleEndian === scratch.hostLittleEndian,
  );
  return scratch.f64[0] ?? 0;
}

/** Zero-allocation 64-bit word read into caller-owned `[lo, hi]` scratch. */
export function dataViewReadWord64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean,
  out: Uint32Array,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const b0 = bytes[offset] ?? 0,
    b1 = bytes[offset + 1] ?? 0,
    b2 = bytes[offset + 2] ?? 0,
    b3 = bytes[offset + 3] ?? 0,
    b4 = bytes[offset + 4] ?? 0,
    b5 = bytes[offset + 5] ?? 0,
    b6 = bytes[offset + 6] ?? 0,
    b7 = bytes[offset + 7] ?? 0;
  if (littleEndian) {
    out[0] = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    out[1] = (b4 | (b5 << 8) | (b6 << 16) | (b7 << 24)) >>> 0;
  } else {
    out[1] = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    out[0] = ((b4 << 24) | (b5 << 16) | (b6 << 8) | b7) >>> 0;
  }
}

/** Zero-allocation 64-bit word write from caller-owned `[lo, hi]` scratch. */
export function dataViewWriteWord64(
  view: NativeDataViewBox,
  byteOffset: number,
  input: Uint32Array,
  littleEndian: boolean,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const lo = input[0] ?? 0,
    hi = input[1] ?? 0;
  if (littleEndian) {
    bytes[offset] = lo & 0xff;
    bytes[offset + 1] = (lo >>> 8) & 0xff;
    bytes[offset + 2] = (lo >>> 16) & 0xff;
    bytes[offset + 3] = (lo >>> 24) & 0xff;
    bytes[offset + 4] = hi & 0xff;
    bytes[offset + 5] = (hi >>> 8) & 0xff;
    bytes[offset + 6] = (hi >>> 16) & 0xff;
    bytes[offset + 7] = (hi >>> 24) & 0xff;
  } else {
    bytes[offset] = (hi >>> 24) & 0xff;
    bytes[offset + 1] = (hi >>> 16) & 0xff;
    bytes[offset + 2] = (hi >>> 8) & 0xff;
    bytes[offset + 3] = hi & 0xff;
    bytes[offset + 4] = (lo >>> 24) & 0xff;
    bytes[offset + 5] = (lo >>> 16) & 0xff;
    bytes[offset + 6] = (lo >>> 8) & 0xff;
    bytes[offset + 7] = lo & 0xff;
  }
}

export function dataViewGetBigUint64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): bigint {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const lo = dataViewGetUint32(
      view,
      littleEndian ? offset : offset + 4,
      littleEndian,
    ),
    hi = dataViewGetUint32(
      view,
      littleEndian ? offset + 4 : offset,
      littleEndian,
    );
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function dataViewGetBigInt64(
  view: NativeDataViewBox,
  byteOffset: number,
  littleEndian: boolean = false,
): bigint {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const lo = dataViewGetUint32(
      view,
      littleEndian ? offset : offset + 4,
      littleEndian,
    ),
    hi = dataViewGetInt32(
      view,
      littleEndian ? offset + 4 : offset,
      littleEndian,
    );
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function dataViewSetInt8(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 1);
  bytes[offset] = value & 0xff;
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
  const scratch = view.scratch ?? initScratch(view);
  scratch.f16[0] = value;
  const u8 = scratch.u8;
  if (littleEndian === scratch.hostLittleEndian) {
    bytes[offset] = u8[0] ?? 0;
    bytes[offset + 1] = u8[1] ?? 0;
  } else {
    bytes[offset] = u8[1] ?? 0;
    bytes[offset + 1] = u8[0] ?? 0;
  }
}

export function dataViewSetFloat32(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 4);
  const scratch = view.scratch ?? initScratch(view);
  scratch.f32[0] = value;
  const u8 = scratch.u8;
  if (littleEndian === scratch.hostLittleEndian) {
    bytes[offset] = u8[0] ?? 0;
    bytes[offset + 1] = u8[1] ?? 0;
    bytes[offset + 2] = u8[2] ?? 0;
    bytes[offset + 3] = u8[3] ?? 0;
  } else {
    bytes[offset] = u8[3] ?? 0;
    bytes[offset + 1] = u8[2] ?? 0;
    bytes[offset + 2] = u8[1] ?? 0;
    bytes[offset + 3] = u8[0] ?? 0;
  }
}

export function dataViewSetFloat64(
  view: NativeDataViewBox,
  byteOffset: number,
  value: number,
  littleEndian: boolean = false,
): void {
  const bytes = view.bytes;
  const offset = checkOffset(bytes, byteOffset, 8);
  const scratch = view.scratch ?? initScratch(view);
  scratch.f64[0] = value;
  storeScratch8(
    bytes,
    offset,
    scratch.u8,
    littleEndian === scratch.hostLittleEndian,
  );
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
