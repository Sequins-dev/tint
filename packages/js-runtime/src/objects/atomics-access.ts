import {
  readUnsigned,
  writeUnsigned,
  readWord64,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import type { StorageAccess } from "../bytes/index.ts";
import { bufferIndex } from "./array-buffer.ts";
import type { BufferStorageWindow } from "./buffer-storage.ts";
import { readBigIntBytes, writeBigIntBytes } from "./bigint-bytes.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { integerOrInfinity, numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { readNumericElement, writeNumericElement } from "./numeric-element.ts";
import {
  createObject,
  createDataProperty,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  requireTypedArray,
  typedArrayWindow,
  typedArrayElementWidth,
  type TypedArrayData,
} from "./typed-array-data.ts";
import {
  readTypedArrayBytes,
  writeTypedArrayBytes,
} from "./typed-array-storage.ts";

interface AtomicAccess {
  readonly data: TypedArrayData;
  readonly index: number;
}
interface IntegerArrayWitness {
  readonly data: TypedArrayData;
  readonly length: number;
}
function validateIntegerTypedArray(
  value: unknown,
  access: StorageAccess,
  realm: ErrorRealm,
  waitable: boolean,
): IntegerArrayWitness {
  const data = requireTypedArray(value, realm, access);
  const window = typedArrayWindow(data, access, "unordered");
  if (window === undefined) throw createRuntimeError(realm, "type");
  const kind = data.kind;
  if (waitable && kind !== "Int32" && kind !== "BigInt64")
    throw createRuntimeError(realm, "type");
  if (
    kind === "Float16" ||
    kind === "Float32" ||
    kind === "Float64" ||
    kind === "Uint8Clamped"
  )
    throw createRuntimeError(realm, "type");
  return { data, length: window.length };
}
/** Capture length before index hooks. Shared-buffer validation for waits belongs
 * between these two phases, before any observable index conversion. */
function validateAtomicIndex(
  witness: IntegerArrayWitness,
  index: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): AtomicAccess {
  const converted = bufferIndex(index, realm, hooks);
  if (converted >= witness.length) throw createRuntimeError(realm, "range");
  return { data: witness.data, index: converted };
}
function validateAtomicAccess(
  value: unknown,
  index: unknown,
  access: StorageAccess,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  waitable: boolean = false,
): AtomicAccess {
  return validateAtomicIndex(
    validateIntegerTypedArray(value, access, realm, waitable),
    index,
    realm,
    hooks,
  );
}
/** Revalidate only after every operand conversion. A fixed out-of-bounds view
 * throws TypeError; an otherwise valid tracking view with a lost index throws RangeError. */
function revalidateAtomicAccess(
  access: AtomicAccess,
  mode: StorageAccess,
  realm: ErrorRealm,
): BufferStorageWindow {
  const window = typedArrayWindow(access.data, mode, "unordered");
  if (window === undefined) throw createRuntimeError(realm, "type");
  if (access.index >= window.length) throw createRuntimeError(realm, "range");
  return window;
}
export function loadAtomicValue(
  value: unknown,
  index: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const access = validateAtomicAccess(value, index, "read", realm, hooks);
  const window = revalidateAtomicAccess(access, "read", realm);
  const data = access.data,
    kind = data.kind;
  const bytes = readTypedArrayBytes(data, access.index, window, "seq-cst");
  return kind === "BigInt64" || kind === "BigUint64"
    ? readBigIntBytes(bytes, 0, data.endian, kind === "BigInt64")
    : readNumericElement(bytes, 0, kind, data.endian);
}
export function storeAtomicValue(
  value: unknown,
  index: unknown,
  operand: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const access = validateAtomicAccess(value, index, "write", realm, hooks);
  const data = access.data,
    kind = data.kind;
  if (kind === "BigInt64" || kind === "BigUint64") {
    const converted = coerceBigInt(operand, false, realm, hooks);
    const window = revalidateAtomicAccess(access, "write", realm);
    const bytes = new Uint8Array(8);
    writeBigIntBytes(bytes, 0, converted, data.endian);
    writeTypedArrayBytes(data, access.index, bytes, window, "seq-cst");
    return converted;
  }
  const converted = integerOrInfinity(operand, hooks, realm);
  const window = revalidateAtomicAccess(access, "write", realm);
  const bytes = new Uint8Array(typedArrayElementWidth(kind));
  writeNumericElement(bytes, 0, kind, converted, data.endian);
  writeTypedArrayBytes(data, access.index, bytes, window, "seq-cst");
  return converted;
}

/** Coerce both operands before revalidation, then compare their encoded bits.
 * Shared storage delegates one indivisible operation to its trusted capability. */
export function compareExchangeAtomicValue(
  value: unknown,
  index: unknown,
  expected: unknown,
  replacement: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const access = validateAtomicAccess(value, index, "write", realm, hooks);
  const data = access.data,
    kind = data.kind;
  const width = typedArrayElementWidth(kind);
  const expectedBytes = new Uint8Array(width),
    replacementBytes = new Uint8Array(width);
  if (kind === "BigInt64" || kind === "BigUint64") {
    const from = coerceBigInt(expected, false, realm, hooks);
    const to = coerceBigInt(replacement, false, realm, hooks);
    writeBigIntBytes(expectedBytes, 0, from, data.endian);
    writeBigIntBytes(replacementBytes, 0, to, data.endian);
  } else {
    const from = integerOrInfinity(expected, hooks, realm);
    const to = integerOrInfinity(replacement, hooks, realm);
    writeNumericElement(expectedBytes, 0, kind, from, data.endian);
    writeNumericElement(replacementBytes, 0, kind, to, data.endian);
  }
  const window = revalidateAtomicAccess(access, "write", realm);
  const observed = compareExchangeBytes(
    data,
    access.index,
    window,
    expectedBytes,
    replacementBytes,
    realm,
  );
  return kind === "BigInt64" || kind === "BigUint64"
    ? readBigIntBytes(observed, 0, data.endian, kind === "BigInt64")
    : readNumericElement(observed, 0, kind, data.endian);
}

/** Encoded payloads separate observable coercions from the retryable operation. */
function compareExchangeBytes(
  data: TypedArrayData,
  index: number,
  window: BufferStorageWindow,
  expectedBytes: Uint8Array,
  replacementBytes: Uint8Array,
  realm: ErrorRealm,
): Uint8Array {
  const width = typedArrayElementWidth(data.kind);
  let observed: Uint8Array;
  const shared = window.shared;
  if (shared === undefined) {
    observed = readTypedArrayBytes(data, index, window);
    let matches = true;
    for (let i = 0; i < width; i++)
      if (observed[i] !== expectedBytes[i]) matches = false;
    if (matches) writeTypedArrayBytes(data, index, replacementBytes, window);
  } else {
    const atomic = shared.service.atomics;
    if (atomic === undefined) return rejectUnsupportedExecution(realm);
    const offset = data.byteOffset + index * width;
    observed = new Uint8Array(width);
    if (width === 8) {
      const from = readWord64(expectedBytes, 0, data.endian);
      const to = readWord64(replacementBytes, 0, data.endian);
      if (!from.ok || !to.ok) throw "ATOMIC_WORD_ENCODING_INVARIANT";
      const scratch = new Uint32Array(2);
      if (
        atomic.compareExchangeWord64(
          shared.handle,
          offset,
          from.value.lo,
          from.value.hi,
          to.value.lo,
          to.value.hi,
          scratch,
        ) !== "none"
      )
        throw "ATOMIC_WORD_COMPARE_EXCHANGE_INVARIANT";
      if (
        !writeWord64(
          observed,
          0,
          { lo: scratch[0] ?? 0, hi: scratch[1] ?? 0 },
          data.endian,
        ).ok
      )
        throw "ATOMIC_WORD_DECODING_INVARIANT";
    } else {
      const narrow = width === 1 ? 1 : width === 2 ? 2 : 4;
      const from = readUnsigned(expectedBytes, 0, narrow, data.endian);
      const to = readUnsigned(replacementBytes, 0, narrow, data.endian);
      if (!from.ok || !to.ok) throw "ATOMIC_UNSIGNED_ENCODING_INVARIANT";
      const old = atomic.compareExchangeUnsigned(
        shared.handle,
        offset,
        narrow,
        from.value,
        to.value,
      );
      if (
        !old.ok ||
        !writeUnsigned(observed, 0, narrow, old.value, data.endian).ok
      )
        throw "ATOMIC_UNSIGNED_COMPARE_EXCHANGE_INVARIANT";
    }
  }
  return observed;
}
export type AtomicUpdate = "exchange" | "add" | "sub" | "and" | "or" | "xor";
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}
/** Byte arithmetic is modular at the element width, including exact 64-bit
 * values. CAS retries only pure encoded work; Script hooks run exactly once. */
export function updateAtomicValue(
  operation: AtomicUpdate,
  value: unknown,
  index: unknown,
  operand: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const access = validateAtomicAccess(value, index, "write", realm, hooks);
  const data = access.data,
    kind = data.kind;
  const width = typedArrayElementWidth(kind),
    input = new Uint8Array(width);
  if (kind === "BigInt64" || kind === "BigUint64") {
    const converted = coerceBigInt(operand, false, realm, hooks);
    writeBigIntBytes(input, 0, converted, data.endian);
  } else {
    const converted = integerOrInfinity(operand, hooks, realm);
    writeNumericElement(input, 0, kind, converted, data.endian);
  }
  const window = revalidateAtomicAccess(access, "write", realm);
  if (
    window.shared !== undefined &&
    window.shared.service.atomics === undefined
  )
    return rejectUnsupportedExecution(realm);
  let previous = readTypedArrayBytes(data, access.index, window, "seq-cst");
  const next = new Uint8Array(width);
  while (true) {
    let carry = 0;
    for (let at = 0; at < width; at++) {
      const byte = data.endian === "little" ? at : width - at - 1;
      const left = previous[byte] ?? 0,
        right = input[byte] ?? 0;
      let result = right;
      if (operation === "add") result = left + right + carry;
      else if (operation === "sub") result = left - right + carry;
      else if (operation === "and") result = left & right;
      else if (operation === "or") result = left | right;
      else if (operation === "xor") result = left ^ right;
      carry = result < 0 ? -1 : result > 255 ? 1 : 0;
      next[byte] = (result + 256) % 256;
    }
    const observed = compareExchangeBytes(
      data,
      access.index,
      window,
      previous,
      next,
      realm,
    );
    if (equalBytes(observed, previous)) break;
    previous = observed;
  }
  return kind === "BigInt64" || kind === "BigUint64"
    ? readBigIntBytes(previous, 0, data.endian, kind === "BigInt64")
    : readNumericElement(previous, 0, kind, data.endian);
}

/** Notify has no post-count revalidation: ordinary backing returns zero even
 * when a count hook detached or resized it after the initial access validation. */
export function notifyAtomicWaiters(
  value: unknown,
  index: unknown,
  count: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const access = validateAtomicAccess(value, index, "read", realm, hooks, true);
  const converted =
    count === undefined
      ? 1 / 0
      : Math.max(integerOrInfinity(count, hooks, realm), 0);
  const data = access.data,
    storage = data.storage;
  if (storage.kind === "ordinary") return 0;
  const notifications = storage.service.notifications;
  if (notifications === undefined) return rejectUnsupportedExecution(realm);
  const width = data.kind === "Int32" ? 4 : 8;
  const result = notifications.notify(
    storage.handle,
    data.byteOffset + access.index * width,
    width,
    converted,
  );
  if (!result.ok) throw "ATOMIC_NOTIFY_INVARIANT";
  return result.value;
}

/** The no-enqueue cases linearize at one atomic read after all coercions and
 * the suspension check. They need no waiter registration or notification lock;
 * a matching value with positive timeout still requires real parking authority. */
export function prepareAtomicWait(
  asynchronous: boolean,
  value: unknown,
  index: unknown,
  expected: unknown,
  timeout: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const witness = validateIntegerTypedArray(value, "read", realm, true);
  if (witness.data.storage.kind !== "shared")
    throw createRuntimeError(realm, "type");
  const access = validateAtomicIndex(witness, index, realm, hooks);
  const data = access.data,
    kind = data.kind;
  const expectedBytes = new Uint8Array(typedArrayElementWidth(kind));
  if (kind === "BigInt64")
    writeBigIntBytes(
      expectedBytes,
      0,
      coerceBigInt(expected, false, realm, hooks),
      data.endian,
    );
  else
    writeNumericElement(
      expectedBytes,
      0,
      "Int32",
      integerOrInfinity(expected, hooks, realm),
      data.endian,
    );
  const converted = numberValue(timeout, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  if (!asynchronous && !realm.agent.canSuspend)
    throw createRuntimeError(realm, "type");
  const window = revalidateAtomicAccess(access, "read", realm);
  const observed = readTypedArrayBytes(data, access.index, window, "seq-cst");
  let result: string;
  if (!equalBytes(observed, expectedBytes)) result = "not-equal";
  else if (converted.value <= 0) result = "timed-out";
  else return rejectUnsupportedExecution(realm);
  if (!asynchronous) return result;
  const object = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(
      object,
      "async",
      false,
      hooks,
    ) ||
    !createDataProperty<ScriptPropertyKey, unknown>(
      object,
      "value",
      result,
      hooks,
    )
  )
    throw "ATOMIC_WAIT_RESULT_INVARIANT";
  return object;
}
