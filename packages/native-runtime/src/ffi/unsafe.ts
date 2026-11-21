/** `tint:ffi/unsafe` (docs/native-ffi.md, "Foreign memory"): views over
 * memory C owns. Importing this module is the only way to read memory at
 * an arbitrary address, so every such use is visible in imports (the
 * workspace boundary check lists the modules allowed to).
 *
 * A foreign view is a byte view of a borrowed-kind Uint8Array (like
 * external storage) whose data is C's memory: collectors move the view
 * objects, never the data; they neither free the memory nor treat it as a
 * root. Being a view, it is never external storage: `address` and
 * `release` reject it. Its lifetime
 * and extent are C's contract: a view outliving the memory reads whatever
 * the address then holds, or faults. Creation checks the address and
 * extent once (a null or inexact address throws TypeError, an extent past
 * the address space RangeError); accesses through a view of R stay within
 * R's size like any other view. */
import { adoptExternal } from "./primitives.ts";
import { readCString } from "./c-string.ts";

/** Largest view: typed-array lengths are 32-bit. */
const maximumBytes = 4294967295;
/** 2^64: the first value past the address space. */
const addressLimit = 18446744073709551616;
/** The shape of a binding's Layout constant these functions read. */
interface RecordLayout {
  readonly size: number;
}

/** `address` as a foreign address: an exact nonzero unsigned 64-bit
 * integer (Address values are numbers), else TypeError. */
function foreignAddress(address: number): number {
  if (address === 0) throw new TypeError("null C address");
  if (!Number.isInteger(address) || address < 0 || address >= addressLimit)
    throw new TypeError("invalid C address");
  return address;
}
/** A byte view of the `length` bytes C owns at `address`. */
export function bytesAt(address: number, length: number): Uint8Array {
  foreignAddress(address);
  if (!Number.isInteger(length) || length < 0 || length > maximumBytes)
    throw new RangeError("invalid foreign byte length");
  // Exact: both terms are integers and the difference is below 2^64.
  if (length > addressLimit - address)
    throw new RangeError("foreign bytes extend past the address space");
  // A view (not the borrowed array itself) so `address` and `release`
  // reject it even when the address lies in live external storage.
  return adoptExternal(new Uint8Array(0), address, length).subarray(0);
}
/** A view of record `layout` at `address` (the checker types it as the
 * record's `View<R>`). */
export function viewAt(layout: RecordLayout, address: number): Uint8Array {
  return bytesAt(address, layout.size);
}
/** Views of the `count` consecutive records `layout` at `address` (the
 * checker types them as `View<R>[]`): one foreign extent, each element a
 * view of its record's bytes. */
export function arrayAt(
  layout: RecordLayout,
  address: number,
  count: number,
): Uint8Array[] {
  const size = layout.size;
  if (!Number.isInteger(count) || count < 0 || count * size > maximumBytes)
    throw new RangeError("invalid foreign record count");
  const views: Uint8Array[] = [];
  if (count === 0) {
    foreignAddress(address);
    return views;
  }
  const bytes = bytesAt(address, count * size);
  for (let index = 0; index < count; index++)
    views.push(bytes.subarray(index * size, (index + 1) * size));
  return views;
}
/** A copy of the NUL-terminated UTF-8 text at `text` (malformed sequences
 * become U+FFFD); a null address throws TypeError. */
export function cStringAt(text: number): string {
  if (text === 0) throw new TypeError("null C string");
  return readCString(foreignAddress(text));
}
export {
  foreignFunction,
  setNumber,
  setBoolean,
  setWords,
  setBytes,
  setRecord,
  setCallback,
  invoke,
  resultNumber,
  resultBoolean,
  resultLow,
  resultHigh,
  resultRecord,
  openLibrary,
  openProgram,
  findSymbol,
  findSymbolWords,
  closeLibrary,
  optionalSymbol,
  type ForeignFunction,
  type DynamicCallback,
  type LibraryHandle,
  type SymbolAddress,
  type ForeignSignature,
  type ForeignType,
} from "./dynamic.ts";
export {
  bytesAtWords,
  stableAddressWords,
  callScalarForeign,
  callScalarForeignCallbacks,
} from "./address-words.ts";

export { allocateCallbackStub, releaseCallbackStub } from "./callback-stubs.ts";
export {
  callbackDispatcher,
  hasRegisteredCallbacks,
  registeredCallbackActivity,
  rethrowCallbackFailure,
  type CallbackActivity,
  type CallbackDispatcher,
} from "./index.ts";
