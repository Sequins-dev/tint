import { retargetByteStorage, type ByteStorage } from "@tint/js-runtime/bytes";
import type { SharedBlockStorage } from "@tint/js-runtime/bytes/shared";
import {
  adoptArrayBuffer,
  builtinFunction,
  createDataProperty,
  projectArrayBufferViewRange,
  viewObjectValue,
  type ObjectCall,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { Cell } from "tint:c/dl";
import { external, stableBytes, type View } from "tint:ffi";
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
const scalarWidths: number[] = [1, 1, 2, 2, 4, 4, 8, 8, 4, 8];
const scalarMinimums: number[] = [-128, 0, -32768, 0, -2147483648, 0];
const scalarMaximums: number[] = [
  127, 255, 32767, 65535, 2147483647, 4294967295,
];

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

export function writeScalar(
  core: ProgramRealmCore,
  cell: View<Cell>,
  kind: number,
  value: unknown,
): void {
  const name = scalarNames[kind] ?? "numeric";
  if (kind === 6 || kind === 7) {
    const bits =
      typeof value === "bigint"
        ? value
        : typeof value === "number" && Number.isSafeInteger(value)
          ? BigInt(value)
          : undefined;
    const signed = kind === 6;
    if (
      bits === undefined ||
      bits < (signed ? -0x8000000000000000n : 0n) ||
      bits > (signed ? 0x7fffffffffffffffn : maxPointer)
    )
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_VALUE",
        "Value must be a " + name,
      );
    cell.halves.low = Number(bits & 0xffffffffn);
    cell.halves.high = Number((bits >> 32n) & 0xffffffffn);
    return;
  }
  if (
    typeof value !== "number" ||
    (kind < 6 &&
      (!Number.isInteger(value) ||
        value < (scalarMinimums[kind] ?? 0) ||
        value > (scalarMaximums[kind] ?? 0)))
  )
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_VALUE",
      "Value must be a " + name,
    );
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
  function nullPointer(): never {
    return ffiError(
      core,
      "error",
      "ERR_FFI_INVALID_POINTER",
      "Cannot dereference a null pointer",
    );
  }
  function readPointer(value: unknown): bigint {
    if (typeof value !== "bigint") return type("The pointer must be a bigint");
    if (value < 0n || value > maxPointer)
      return invalid(
        "The pointer must be a non-negative bigint within the platform pointer range",
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
  function validateSpan(address: bigint, count: number): void {
    if (
      address > maxPointer ||
      (count > 0 && BigInt(count - 1) > maxPointer - address)
    )
      invalid("The accessed range exceeds the platform address range");
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
    validateSpan(start, 1);
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
    const address = readPointer(args[0]);
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

  function importBytes(args: readonly unknown[]): Uint8Array {
    const address = readPointer(args[0]);
    const count = size(args[1], "length", false);
    if (address === 0n && count !== 0) return nullPointer();
    validateSpan(address, count);
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
    adoptNodeBuffer(core, importBytes(args)),
  );
  define("toArrayBuffer", 0, (_receiver, args): unknown =>
    adoptArrayBuffer(importBytes(args), core.realm),
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
    const storage = source.internalArrayBufferData;
    if (brand === "ArrayBuffer" ? storage === undefined : window === undefined)
      return type("The source must be a " + brand);
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
    const storage = window?.storage ?? source.internalArrayBufferData;
    if (storage === undefined) {
      const shared = source.internalSharedArrayBufferData;
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
