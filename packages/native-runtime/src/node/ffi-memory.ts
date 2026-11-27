import { retargetByteStorage, type ByteStorage } from "@tint/js-runtime/bytes";
import type { SharedBlockStorage } from "@tint/js-runtime/bytes/shared";
import {
  adoptArrayBuffer,
  builtinFunction,
  createDataProperty,
  exoticSlots,
  projectArrayBufferViewRange,
  viewBigIntValue,
  viewObjectValue,
  type ObjectCall,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { Cell } from "tint:c/dl";
import { external, stableBytes, type View } from "tint:ffi";
import type { CallbackActivity } from "../ffi/index.ts";
export type { CallbackActivity };
import { adoptNodeBuffer, isNodeBuffer } from "./buffer.ts";
import { bufferBytes, bufferEncoding, bufferText } from "./buffer-codecs.ts";
import { ffiError, type FfiObject } from "./ffi-signature.ts";

/** Only the trusted Node FFI entry point acquires raw address capabilities. */
export interface FfiMemoryHost {
  readonly view: (address: bigint, length: number) => Uint8Array;
  readonly address: (bytes: Uint8Array) => bigint;
}

const maxPointer = 0xffffffffffffffffn;
const maxStringBytes = 536870888;
const scalarNames: string[] = [
  "Int8",
  "Uint8",
  "Int16",
  "Uint16",
  "Int32",
  "Uint32",
  "Int64",
  "Uint64",
  "Float32",
  "Float64",
];
const scalarLabels: string[] = [
  "an int8",
  "a uint8",
  "an int16",
  "a uint16",
  "an int32",
  "a uint32",
  "an int64",
  "a uint64",
  "a float",
  "a double",
];
const scalarWidths: number[] = [1, 1, 2, 2, 4, 4, 8, 8, 4, 8];
/** Integer kinds 0-5 are i8, u8, i16, u16, i32 and u32. Call sites pass a
 * constant kind, so these bounds fold instead of reading a table. */
function scalarMinimum(kind: number): number {
  switch (kind) {
    case 0:
      return -128;
    case 2:
      return -32768;
    case 4:
      return -2147483648;
    default:
      return 0;
  }
}
function scalarMaximum(kind: number): number {
  switch (kind) {
    case 0:
      return 127;
    case 1:
      return 255;
    case 2:
      return 32767;
    case 3:
      return 65535;
    case 4:
      return 2147483647;
    case 5:
      return 4294967295;
    default:
      return 0;
  }
}

export interface FfiScalarParameter {
  readonly kind: number;
  readonly pointer: boolean;
  readonly offset: number;
  readonly register: boolean;
  readonly signExtend: boolean;
}

export interface TypedFfiWorkspace {
  readonly frame: Uint8Array;
  readonly cells: readonly Uint8Array[];
  readonly result: Uint8Array;
  readonly loans: Uint8Array[];
}

export interface FfiLibraryLifetime {
  open: boolean;
}

/** A private reciprocal view of one validated bound function. JavaScript
 * properties, bound functions, and proxies cannot supply this witness. */
export interface TypedFfiCall {
  readonly arity: number;
  readonly staticIndex: number;
  readonly address: number;
  readonly lifetime: FfiLibraryLifetime;
  readonly nodeCallbacks: CallbackActivity;
  readonly nativeCallbacks: CallbackActivity;
  readonly mode: () => number;
  readonly numbersOnly: boolean;
  readonly unaryPointerLeaf: ((input: unknown) => number) | undefined;
  readonly pointerI32Callback:
    ((address: unknown, input: number) => number | undefined) | undefined;
  readonly workspace: (mayCallback: boolean) => TypedFfiWorkspace;
  readonly checkNumber: (kind: number, input: number, index: number) => number;
  readonly writeNumber: (
    workspace: TypedFfiWorkspace,
    index: number,
    input: number,
  ) => void;
  readonly writeArgument: (
    workspace: TypedFfiWorkspace,
    index: number,
    input: unknown,
  ) => void;
  readonly complete: (
    workspace: TypedFfiWorkspace,
    mayCallback: boolean,
  ) => number;
  readonly release: (workspace: TypedFfiWorkspace) => void;
}

export function viewTypedFfiCall(value: unknown): TypedFfiCall | undefined {
  throw "UNBOUND_TYPED_FFI_VIEW";
}

/** Small pointer BigInts fit exactly in the typed address representation. */
export function projectFfiPointerAddress(input: unknown): number | undefined {
  const value = viewBigIntValue(input);
  if (value === undefined || value.integer.negative) return undefined;
  const integer = value.integer;
  const high = integer.d2;
  if (integer.len > 3 || high > 1) return undefined;
  return integer.d0 + integer.d1 * 67108864 + high * 4503599627370496;
}

export function readTypedFfiNumber(bytes: Uint8Array, kind: number): number {
  return readFfiNumberCell(Cell.view(bytes), kind);
}

export function readFfiNumberCell(cell: View<Cell>, kind: number): number {
  switch (kind) {
    case 0:
      return cell.i8;
    case 1:
      return cell.u8;
    case 2:
      return cell.i16;
    case 3:
      return cell.u16;
    case 4:
      return cell.i32;
    case 5:
      return cell.u32;
    case 8:
      return cell.f32;
    case 9:
      return cell.f64;
    default:
      throw "TYPED_FFI_NUMBER_KIND_INVARIANT";
  }
}

export function readScalar(cell: View<Cell>, kind: number): unknown {
  switch (kind) {
    case 0:
      return cell.i8;
    case 1:
      return cell.u8;
    case 2:
      return cell.i16;
    case 3:
      return cell.u16;
    case 4:
      return cell.i32;
    case 5:
      return cell.u32;
    case 6:
    case 7: {
      const high = cell.halves.high;
      const bits = (BigInt(high) << 32n) | BigInt(cell.halves.low);
      return kind === 6 && high >= 2147483648 ? bits - (1n << 64n) : bits;
    }
    case 8:
      return cell.f32;
    case 9:
      return cell.f64;
    default:
      throw "FFI_MEMORY_KIND_INVARIANT";
  }
}

function invalidScalar(
  core: ProgramRealmCore,
  kind: number,
  argumentIndex: number,
): never {
  const subject = argumentIndex < 0 ? "Value" : "Argument " + argumentIndex;
  const label = scalarLabels[kind] ?? "a number";
  return ffiError(
    core,
    "type",
    "ERR_INVALID_ARG_VALUE",
    subject + " must be " + label,
  );
}

/** Validate an i32 argument, testing an exact int32 first. -0 passes, as
 * it does in the general check. */
export function checkedFfiI32(
  core: ProgramRealmCore,
  value: unknown,
  argumentIndex: number,
): number {
  if (typeof value === "number" && (value | 0) === value) return value;
  return checkedFfiNumber(core, 4, value, argumentIndex);
}

export function checkedFfiNumber(
  core: ProgramRealmCore,
  kind: number,
  value: unknown,
  argumentIndex: number,
): number {
  if (
    typeof value !== "number" ||
    (kind < 6 &&
      (!Number.isInteger(value) ||
        value < scalarMinimum(kind) ||
        value > scalarMaximum(kind)))
  )
    return invalidScalar(core, kind, argumentIndex);
  return value;
}

export function checkedTypedFfiNumber(
  core: ProgramRealmCore,
  kind: number,
  value: number,
  argumentIndex: number,
): number {
  if (
    kind < 6 &&
    (!Number.isInteger(value) ||
      value < scalarMinimum(kind) ||
      value > scalarMaximum(kind))
  )
    return invalidScalar(core, kind, argumentIndex);
  return value;
}

/** Write an in-range BigInt directly from its canonical base-2^26 digits.
 * Converting the halves through JS bitwise BigInt operators would allocate
 * intermediate values on every pointer or 64-bit argument. */
export function writeFfiBigInt(
  cell: View<Cell>,
  input: unknown,
  signed: boolean,
): boolean {
  const value = viewBigIntValue(input);
  if (value === undefined) return false;
  const integer = value.integer;
  const negative = integer.negative;
  if (integer.len > 3 || (negative && !signed)) return false;
  const third = integer.d2;
  if (third >= 4096) return false;
  const second = integer.d1;
  const low = integer.d0 + (second % 64) * 67108864;
  const high = Math.floor(second / 64) + third * 1048576;
  if (
    signed &&
    high >= 2147483648 &&
    (!negative || high !== 2147483648 || low !== 0)
  )
    return false;
  cell.halves.low = negative ? (4294967296 - low) % 4294967296 : low;
  cell.halves.high = negative ? 4294967295 - high + (low === 0 ? 1 : 0) : high;
  return true;
}

export function writeScalar(
  core: ProgramRealmCore,
  cell: View<Cell>,
  kind: number,
  input: unknown,
  argumentIndex: number = -1,
): void {
  if (kind === 6 || kind === 7) {
    const signed = kind === 6;
    if (typeof input === "number") {
      if (!Number.isSafeInteger(input) || (!signed && input < 0))
        return invalidScalar(core, kind, argumentIndex);
      const high = Math.floor(input / 4294967296);
      cell.halves.low = input - high * 4294967296;
      cell.halves.high = high < 0 ? high + 4294967296 : high;
    } else if (!writeFfiBigInt(cell, input, signed))
      return invalidScalar(core, kind, argumentIndex);
    return;
  }
  writeFfiNumberCell(
    cell,
    kind,
    checkedFfiNumber(core, kind, input, argumentIndex),
  );
}

function writeFfiNumberCell(
  cell: View<Cell>,
  kind: number,
  value: number,
): void {
  switch (kind) {
    case 0:
      cell.i8 = value;
      break;
    case 1:
      cell.u8 = value;
      break;
    case 2:
      cell.i16 = value;
      break;
    case 3:
      cell.u16 = value;
      break;
    case 4:
      cell.i32 = value;
      break;
    case 5:
      cell.u32 = value;
      break;
    case 8:
      cell.f32 = value;
      break;
    case 9:
      cell.f64 = value;
      break;
    default:
      throw "FFI_MEMORY_KIND_INVARIANT";
  }
}

export function writeTypedFfiResult(
  core: ProgramRealmCore,
  cell: View<Cell>,
  kind: number,
  input: number,
): void {
  writeFfiNumberCell(cell, kind, checkedTypedFfiNumber(core, kind, input, -1));
}

export function writeTypedFfiNumber(
  core: ProgramRealmCore,
  parameters: readonly FfiScalarParameter[],
  workspace: TypedFfiWorkspace,
  index: number,
  input: number,
): void {
  const parameter = parameters[index],
    bytes = workspace.cells[index];
  if (parameter === undefined || bytes === undefined)
    throw "TYPED_FFI_FRAME_LAYOUT_INVARIANT";
  const cell = Cell.view(bytes);
  const value = checkedTypedFfiNumber(core, parameter.kind, input, index);
  if (parameter.signExtend) cell.i64 = value;
  else {
    if (parameter.register) cell.u64 = 0;
    writeFfiNumberCell(cell, parameter.kind, value);
  }
}

/** Acquire a live window from the embedding's shared mapping owner. */
export function ffiSharedAddress(
  core: ProgramRealmCore,
  storage: SharedBlockStorage,
  offset: number,
  length: number,
): bigint {
  const address = storage.service.foreignAddress;
  if (address === undefined)
    return ffiError(
      core,
      "error",
      "ERR_FFI_CALL_FAILED",
      "SharedArrayBuffer backing requires an embedding with native shared mappings",
    );
  const resolved = address(storage.handle, offset, length);
  if (!resolved.ok)
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_VALUE",
      "Invalid SharedArrayBuffer backing range",
    );
  return BigInt(resolved.value);
}

/** Keep existing owners and aliases together when C needs a stable address. */
export function stableFfiBacking(
  core: ProgramRealmCore,
  storage: ByteStorage,
  bytes: Uint8Array,
): Uint8Array {
  if (stableBytes(bytes)) return bytes;
  let stable: Uint8Array;
  try {
    stable = external(bytes.length);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return ffiError(
      core,
      "range",
      "ERR_MEMORY_ALLOCATION_FAILED",
      "Memory allocation failed",
    );
  }
  if (!retargetByteStorage(storage, bytes, stable))
    throw "FFI_STORAGE_OWNER_INVARIANT";
  return stable;
}

export function installFfiMemory(
  core: ProgramRealmCore,
  host: FfiMemoryHost,
  table: FfiObject,
): void {
  function type(message: string): never {
    return ffiError(core, "type", "ERR_INVALID_ARG_TYPE", message);
  }
  function invalid(message: string): never {
    return ffiError(core, "type", "ERR_INVALID_ARG_VALUE", message);
  }
  function range(message: string): never {
    return ffiError(core, "range", "ERR_OUT_OF_RANGE", message);
  }
  function nullPointer(
    message: string = "Cannot dereference a null pointer",
  ): never {
    return ffiError(core, "error", "ERR_FFI_INVALID_POINTER", message);
  }
  function readPointer(value: unknown, label: string = "pointer"): bigint {
    if (typeof value !== "bigint")
      return type("The " + label + " must be a bigint");
    if (value < 0n || value > maxPointer)
      return invalid(
        "The " +
          label +
          " must be a non-negative bigint within the platform pointer range",
      );
    return value;
  }
  function size(value: unknown, label: string, exporting: boolean): number {
    if (typeof value !== "number")
      return type("The " + label + " must be a number");
    if (!Number.isInteger(value) || value < 0) {
      const message = "The " + label + " must be a non-negative integer";
      return exporting ? range(message) : invalid(message);
    }
    if (!Number.isSafeInteger(value))
      return range("The " + label + " is too large");
    return value;
  }
  function validateSpan(
    address: bigint,
    count: number,
    message: string = "The accessed range exceeds the platform address range",
  ): void {
    if (
      address > maxPointer ||
      (count > 0 && BigInt(count - 1) > maxPointer - address)
    )
      invalid(message);
  }
  function scalarAddress(
    pointer: unknown,
    offset: unknown,
    writing: boolean,
  ): bigint {
    const address = readPointer(pointer);
    if (address === 0n) return nullPointer();
    if (offset === undefined && writing)
      return invalid("Expected an offset argument");
    const start =
      address +
      BigInt(offset === undefined ? 0 : size(offset, "offset", false));
    validateSpan(
      start,
      1,
      "The pointer and offset exceed the platform address range",
    );
    return start;
  }
  function define(
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): void {
    const fn = builtinFunction(
      core.realm.functionPrototype,
      name,
      length,
      call,
      core.hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(table, name, fn, core.hooks);
  }
  for (let kind = 0; kind < scalarNames.length; kind++) {
    const name = scalarNames[kind];
    const width = scalarWidths[kind];
    if (name === undefined || width === undefined)
      throw "FFI_MEMORY_KIND_INVARIANT";
    const scalarKind = kind;
    define("get" + name, 0, (_receiver, args): unknown => {
      const start = scalarAddress(args[0], args[1], false);
      validateSpan(start, width);
      const scratch = new Uint8Array(Cell.size);
      scratch.set(host.view(start, width));
      return readScalar(Cell.view(scratch), scalarKind);
    });
    define("set" + name, 0, (_receiver, args): unknown => {
      const start = scalarAddress(args[0], args[1], true);
      const value = args[2];
      if (value === undefined) return invalid("Expected a value argument");
      validateSpan(start, width);
      const scratch = new Uint8Array(Cell.size);
      writeScalar(core, Cell.view(scratch), scalarKind, value);
      host.view(start, width).set(scratch.subarray(0, width));
      return undefined;
    });
  }

  define("toString", 0, (_receiver, args): unknown => {
    const address = readPointer(args[0], "first argument");
    if (address === 0n) return null;
    const capacity = Number(
      maxPointer - address < BigInt(maxStringBytes)
        ? maxPointer - address + 1n
        : BigInt(maxStringBytes + 1),
    );
    const bytes = host.view(address, capacity);
    for (let count = 0; count < capacity; count++)
      if (bytes[count] === 0)
        return bufferText(bytes.subarray(0, count), "utf8");
    if (capacity <= maxStringBytes)
      return invalid("The string exceeds the platform address range");
    return ffiError(core, "error", "ERR_STRING_TOO_LONG", "String is too long");
  });

  function importBytes(args: readonly unknown[], kind: string): Uint8Array {
    const address = readPointer(args[0], "first argument");
    const count = size(args[1], "length", false);
    if (address === 0n && count !== 0)
      return nullPointer("Cannot create " + kind + " from a null pointer");
    validateSpan(
      address,
      count,
      "The pointer and length exceed the platform address range",
    );
    const copy = args[2];
    if (copy !== undefined && typeof copy !== "boolean")
      return type("The copy argument must be a boolean");
    if (
      count > 4294967295 ||
      (copy !== false && count > core.realm.bufferMaxBytes)
    )
      return ffiError(
        core,
        "range",
        "ERR_MEMORY_ALLOCATION_FAILED",
        "Memory allocation failed",
      );
    const raw = host.view(address, count);
    if (copy === false) return raw;
    const bytes = new Uint8Array(count);
    bytes.set(raw);
    return bytes;
  }
  define("toBuffer", 0, (_receiver, args): unknown =>
    adoptNodeBuffer(core, importBytes(args, "a buffer")),
  );
  define("toArrayBuffer", 0, (_receiver, args): unknown =>
    adoptArrayBuffer(importBytes(args, "an ArrayBuffer"), core.realm),
  );

  function exportBytes(
    bytes: Uint8Array,
    pointer: unknown,
    count: number,
  ): void {
    const address = readPointer(pointer);
    if (address === 0n && bytes.length > 0) return nullPointer();
    validateSpan(address, count);
    if (bytes.length > 0) host.view(address, bytes.length).set(bytes);
  }
  function ensureFit(count: number, required: number): void {
    if (count < required) range("The length must be >= source byte length");
  }
  define("exportString", 3, (_receiver, args): unknown => {
    const input = args[0];
    if (typeof input !== "string") return type("The string must be a string");
    const encoding = args[3] === undefined ? "utf8" : args[3];
    if (typeof encoding !== "string")
      return type("The encoding must be a string");
    const count = size(args[2], "len", true);
    const selected = bufferEncoding(encoding === "" ? "utf8" : encoding);
    if (selected === undefined)
      return ffiError(
        core,
        "type",
        "ERR_UNKNOWN_ENCODING",
        "Unknown encoding: " + encoding,
      );
    const bytes = bufferBytes(input, selected);
    const extent = bytes.length + (selected === "utf16le" ? 2 : 1);
    ensureFit(count, extent);
    const terminated = new Uint8Array(extent);
    terminated.set(bytes);
    exportBytes(terminated, args[1], count);
    return undefined;
  });

  function exportBuffer(args: readonly unknown[], brand: string): void {
    const source = viewObjectValue(args[0], core.object);
    if (
      source === undefined ||
      (brand === "Buffer" && !isNodeBuffer(core, args[0]))
    )
      return type("The source must be a " + brand);
    const window =
      brand === "ArrayBuffer" ? undefined : projectArrayBufferViewRange(source);
    const storage = exoticSlots(source).internalArrayBufferData;
    if (brand === "ArrayBuffer" ? storage === undefined : window === undefined)
      return type(
        brand === "ArrayBuffer"
          ? 'The "arrayBuffer" argument must be an instance of ArrayBuffer'
          : "The source must be a " + brand,
      );
    const count = size(args[2], "len", true);
    if (window !== undefined) {
      const owner = window.storage;
      if (owner.kind === "shared") {
        const length = window.byteLength;
        ensureFit(count, length);
        const pointer = ffiSharedAddress(
          core,
          owner,
          window.byteOffset,
          length,
        );
        exportBytes(host.view(pointer, length), args[1], count);
        return;
      }
    }
    const bytes = window === undefined ? storage?.data : window.bytes;
    if (bytes === undefined) return invalid("ArrayBuffer is detached");
    const offset = window?.byteOffset ?? 0;
    const length = window?.byteLength ?? bytes.length;
    ensureFit(count, length);
    exportBytes(bytes.subarray(offset, offset + length), args[1], count);
  }
  define("exportBuffer", 3, (_receiver, args): unknown =>
    exportBuffer(args, "Buffer"),
  );
  define("exportArrayBuffer", 3, (_receiver, args): unknown =>
    exportBuffer(args, "ArrayBuffer"),
  );
  define("exportArrayBufferView", 3, (_receiver, args): unknown =>
    exportBuffer(args, "ArrayBufferView"),
  );

  define("getRawPointer", 0, (_receiver, args): unknown => {
    const source = viewObjectValue(args[0], core.object);
    if (source === undefined)
      return type(
        "The source must be an ArrayBuffer, SharedArrayBuffer, or ArrayBufferView",
      );
    const window = projectArrayBufferViewRange(source);
    if (window?.kind === "detached")
      return invalid("ArrayBufferView is backed by a detached ArrayBuffer");
    const slots = exoticSlots(source);
    const storage = window?.storage ?? slots.internalArrayBufferData;
    if (storage === undefined) {
      const shared = slots.internalSharedArrayBufferData;
      if (shared !== undefined) return ffiSharedAddress(core, shared, 0, 0);
      return type(
        "The source must be an ArrayBuffer, SharedArrayBuffer, or ArrayBufferView",
      );
    }
    if (storage.kind === "shared")
      return ffiSharedAddress(
        core,
        storage,
        window?.byteOffset ?? 0,
        window?.byteLength ?? 0,
      );
    const bytes = storage.data;
    if (bytes === undefined) return invalid("ArrayBuffer is detached");
    const stable = stableFfiBacking(core, storage, bytes);
    return host.address(stable) + BigInt(window?.byteOffset ?? 0);
  });
}
