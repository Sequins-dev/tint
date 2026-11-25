import { copyLatin1, latin1Text } from "@tint/foundation/text/latin1";
import { setScriptMap, syncScriptMapNumbers } from "./collection-data.ts";
import { createByteStorage, byteStorageData } from "../bytes/index.ts";
import {
  arrayElementCount,
  firstCapacity,
  noNumbers,
  readArrayElement,
  writeArrayElement,
} from "./array-elements.ts";
import { createArrayObject } from "./arrays.ts";
import {
  bigIntFromString,
  bigIntToString,
  viewBigIntValue,
} from "./bigints.ts";
import { bufferStorageWindow } from "./buffer-storage.ts";
import { toObjectValue } from "./boxing.ts";
import { stringValue } from "./coercion.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { builtinProperty } from "./intrinsics.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createDataProperty,
  createObject,
  getOwnProperty,
  getProperty,
  ownKeys,
  propertyMapKeys,
  type OrdinaryObject,
} from "./operations.ts";
import { createRegExpLiteral } from "./regexp-runtime.ts";
import { createSetData } from "./set-data.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  createTypedArrayView,
  typedArrayWindow,
  type TypedArrayData,
  type TypedArrayElementKind,
} from "./typed-array-data.ts";
import { viewObjectValue } from "./values.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;

/** Native worker hosts prepare and validate grants before publishing a packet.
 * The codec only refers to grant indices. It never moves native ownership. */
export interface WorkerCloneAttachments {
  encode?(object: ScriptObject): number | undefined;
  /** The grant index of the shared block that `buffer`, the buffer of a
   * typed program's native typed array (or a typed SharedArrayBuffer
   * itself), views; undefined for an ordinary buffer, which is copied. */
  encodeNativeBuffer?(buffer: unknown): number | undefined;
  decode?(index: number): ScriptObject | undefined;
  /** Strings of at least this many code units are offered to
   * encodeString. */
  readonly sharedStringUnits?: number;
  /** The grant index of a shared body holding `value` (a string of at least
   * sharedStringUnits units), or undefined to copy it into the message. */
  encodeString?(value: string): number | undefined;
  /** The string of a shared-body grant, or undefined for an invalid one. */
  decodeString?(index: number): string | undefined;
}

export function throwWorkerCloneError(
  realm: ErrorRealm,
  message: string,
): never {
  const error = createRuntimeError(realm, "error");
  builtinProperty(
    error,
    "name",
    "DataCloneError",
    true,
    false,
    realm.objectHooks,
  );
  builtinProperty(error, "message", message, true, false, realm.objectHooks);
  throw error;
}

function unsupportedObject(object: ScriptObject): boolean {
  const rare = object.internalRareSlots;
  if (
    object.internalCall !== undefined ||
    object.internalConstruct !== undefined ||
    (rare !== undefined && rare.internalArgumentsData)
  )
    return true;
  const exotic = object.internalExoticSlots;
  if (exotic === undefined) return false;
  return (
    exotic.internalPromiseData !== undefined ||
    exotic.internalProxyData !== undefined ||
    exotic.internalWeakData !== undefined ||
    exotic.internalGeneratorData !== undefined ||
    exotic.internalAsyncGeneratorData !== undefined ||
    exotic.internalSyncIteratorData !== undefined ||
    exotic.internalIteratorHelperData !== undefined ||
    exotic.internalWrappedIteratorData !== undefined ||
    exotic.internalMapIteratorData !== undefined ||
    exotic.internalSetIteratorData !== undefined ||
    exotic.internalRegExpIteratorData !== undefined ||
    exotic.internalArrayIteratorData !== undefined ||
    exotic.internalStringIteratorData !== undefined ||
    exotic.internalSharedArrayBufferData !== undefined ||
    exotic.internalDisposableStack !== undefined ||
    exotic.internalAsyncDisposableStack !== undefined ||
    exotic.internalTemporalPlainYearMonth !== undefined ||
    exotic.internalTemporalPlainMonthDay !== undefined ||
    exotic.internalTemporalPlainDate !== undefined ||
    exotic.internalTemporalDuration !== undefined ||
    exotic.internalTemporalPlainTime !== undefined ||
    exotic.internalTemporalPlainDateTime !== undefined ||
    exotic.internalTemporalZonedDateTime !== undefined ||
    exotic.internalTemporalCalendar !== undefined ||
    exotic.internalTemporalInstant !== undefined ||
    exotic.internalLocaleData !== undefined ||
    exotic.internalListFormatData !== undefined ||
    exotic.internalSegmenterData !== undefined ||
    exotic.internalCollatorData !== undefined ||
    exotic.internalPluralRulesData !== undefined ||
    exotic.internalIntlFormatData !== undefined ||
    exotic.internalRelativeTimeData !== undefined ||
    exotic.internalNumberFormatData !== undefined ||
    exotic.internalShadowRealm !== undefined
  );
}

function errorKind(name: string): string {
  switch (name) {
    case "TypeError":
      return "type";
    case "RangeError":
      return "range";
    case "ReferenceError":
      return "reference";
    case "SyntaxError":
      return "syntax";
    case "EvalError":
      return "eval";
    case "URIError":
      return "uri";
    default:
      return "error";
  }
}

/** A growable output window for the binary clone codec. Offsets are relative
 * to `bytes`; native hosts back it with an external view of a message packet,
 * whose start is eight-byte aligned. */
export interface WorkerCloneSink {
  bytes: Uint8Array;
  /** Replace `bytes` with a window of at least `used + needed` bytes whose
   * first `used` bytes are unchanged. */
  grow(used: number, needed: number): void;
  /** A binary64 at an eight-byte-aligned offset within `bytes`. */
  writeFloat64(offset: number, value: number): void;
  /** Every UTF-16 code unit of `value`, two bytes each, at `offset`. */
  writeString(offset: number, value: string): void;
}
/** The input window of a received packet; offsets are relative to `bytes`. */
export interface WorkerCloneSource {
  readonly bytes: Uint8Array;
  readFloat64(offset: number): number;
  readString(offset: number, units: number): string;
}

// One-byte tags, after V8's ValueSerializer where one corresponds.
const tagUndefined = 95; // _
const tagNull = 48; // 0
const tagTrue = 84; // T
const tagFalse = 70; // F
const tagInt32 = 73; // I: zigzag varint
const tagDouble = 78; // N: padding to eight bytes, then binary64
const tagOneByteString = 34; // ": varint units, then Latin-1 bytes
const tagString = 99; // c: varint units, then UTF-16 units
const tagBigInt = 90; // Z: decimal digits as a string payload
const tagReference = 94; // ^: varint object index
const tagAttachment = 120; // x: varint grant index
const tagSharedString = 115; // s: varint grant index of a shared string body
const tagBoxed = 119; // w: the boxed primitive value
const tagDate = 68; // D: a double payload
const tagRegExp = 82; // R: source and flags string payloads
const tagError = 69; // E
const tagTypedArray = 86; // V
const tagDataView = 87; // W
const tagArrayBuffer = 66; // B
const tagResizableArrayBuffer = 126; // ~
const tagMap = 59; // ;
const tagSet = 39; // '
const tagDenseArray = 65; // A: elements by position, then properties, $
const tagNumberArray = 80; // P: packed binary64 elements, then properties, $
const tagSparseArray = 97; // a: properties, then @
const tagObject = 111; // o: properties, then {
const tagHole = 45; // -
const tagNewKey = 107; // k: a one-byte property key's payload
const tagTwoByteKey = 108; // l: a UTF-16 property key's payload
const tagKeyReference = 75; // K: varint index of an earlier key
const endObject = 123; // {
const endDenseArray = 36; // $
const endSparseArray = 64; // @

const elementKinds: readonly TypedArrayElementKind[] = [
  "Int8",
  "Uint8",
  "Uint8Clamped",
  "Int16",
  "Uint16",
  "Int32",
  "Uint32",
  "Float16",
  "Float32",
  "Float64",
  "BigInt64",
  "BigUint64",
];
// Short strings copy inline; longer ones in one bulk copy.
const inlineStringUnits = 16;

/** Serialize `value` into `sink` from offset `start` and return the end
 * offset. The traversal, its property order and every getter call match the
 * HTML structured serialization algorithm. Only enumerable own string keys
 * participate in ordinary object and array cloning. */
export function serializeWorkerValue(
  value: unknown,
  realm: ErrorRealm,
  sink: WorkerCloneSink,
  start: number,
  attachments?: WorkerCloneAttachments,
): number {
  if (typeof value === "string" && start >= 0)
    return serializeWorkerString(value, sink, start, attachments);
  const end = serializeWorkerPrimitive(value, sink, start);
  return end >= 0
    ? end
    : serializeWorkerGraph(value, realm, sink, start, attachments);
}
/** A lone string's encoding, matching serializeWorkerGraph without allocating
 * the object, buffer and key reference tables. */
function serializeWorkerString(
  value: string,
  sink: WorkerCloneSink,
  start: number,
  attachments: WorkerCloneAttachments | undefined,
): number {
  const sharedStringUnits = attachments?.sharedStringUnits ?? Infinity;
  let bytes = sink.bytes,
    position = start;
  if (value.length >= sharedStringUnits) {
    const grant = attachments?.encodeString?.(value);
    if (grant !== undefined) {
      if (!Number.isSafeInteger(grant) || grant < 0)
        throw "WORKER_CLONE_COUNT_INVARIANT";
      if (position + 10 > bytes.length) {
        sink.grow(position, 10);
        bytes = sink.bytes;
      }
      bytes[position++] = tagSharedString;
      let remaining = grant;
      while (remaining >= 128) {
        bytes[position++] = (remaining % 128) + 128;
        remaining = Math.floor(remaining / 128);
      }
      bytes[position++] = remaining;
      return position;
    }
  }
  const units = value.length;
  const oneByteNeeded = 9 + units;
  if (position + oneByteNeeded > bytes.length) {
    sink.grow(position, oneByteNeeded);
    bytes = sink.bytes;
  }
  const tagAt = position;
  bytes[position++] = tagOneByteString;
  let remaining = units;
  while (remaining >= 128) {
    bytes[position++] = (remaining % 128) + 128;
    remaining = Math.floor(remaining / 128);
  }
  bytes[position++] = remaining;
  const copied = copyLatin1(value, 0, units, bytes, position);
  if (copied >= 0) return position + copied;
  const twoByteNeeded = units * 2;
  if (position + twoByteNeeded > bytes.length) {
    sink.grow(position, twoByteNeeded);
    bytes = sink.bytes;
  }
  bytes[tagAt] = tagString;
  if (units <= inlineStringUnits) {
    for (let index = 0; index < units; index++) {
      const unit = value.charCodeAt(index);
      bytes[position++] = unit % 256;
      bytes[position++] = Math.floor(unit / 256);
    }
  } else {
    sink.writeString(position, value);
    position += twoByteNeeded;
  }
  return position;
}
/** A lone primitive's encoding, the same bytes the graph encoder writes,
 * without the reference tables an object graph needs; -1 when the value is
 * not one or the sink lacks room. */
function serializeWorkerPrimitive(
  value: unknown,
  sink: WorkerCloneSink,
  start: number,
): number {
  const bytes = sink.bytes;
  // A tag, padding to eight bytes and a binary64, or a five-byte varint.
  if (start < 0 || start + 16 > bytes.length) return -1;
  if (value === undefined) bytes[start] = tagUndefined;
  else if (value === null) bytes[start] = tagNull;
  else if (typeof value === "boolean")
    bytes[start] = value ? tagTrue : tagFalse;
  else if (typeof value !== "number") return -1;
  else if ((value | 0) === value && (value !== 0 || 1 / value > 0)) {
    bytes[start] = tagInt32;
    let zigzag = value >= 0 ? value * 2 : -value * 2 - 1,
      position = start + 1;
    while (zigzag >= 128) {
      bytes[position++] = (zigzag % 128) + 128;
      zigzag = Math.floor(zigzag / 128);
    }
    bytes[position++] = zigzag;
    return position;
  } else {
    bytes[start] = tagDouble;
    let position = start + 1;
    while (position % 8 !== 0) bytes[position++] = 0;
    sink.writeFloat64(position, value);
    return position + 8;
  }
  return start + 1;
}
function serializeWorkerGraph(
  value: unknown,
  realm: ErrorRealm,
  sink: WorkerCloneSink,
  start: number,
  attachments?: WorkerCloneAttachments,
): number {
  const objects = new Map<number, number>();
  // The decoder's object indices: one per object, and a native typed
  // array's view and buffer take one each.
  let objectCount = 0;
  // Object indices of the shared native buffers already serialized, by
  // grant.
  const nativeBuffers = new Map<number, number>();
  const keyIndices = new Map<string, number>();
  // Strings this long may be shared rather than copied (never, without a
  // host that shares them).
  const sharedStringUnits = attachments?.sharedStringUnits ?? Infinity;
  const hooks = realm.objectHooks;
  let bytes = sink.bytes,
    position = start;
  function reserve(count: number): void {
    if (position + count <= bytes.length) return;
    sink.grow(position, count);
    bytes = sink.bytes;
  }
  function tag(value: number): void {
    reserve(1);
    bytes[position++] = value;
  }
  function varint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw "WORKER_CLONE_COUNT_INVARIANT";
    reserve(8);
    while (value >= 128) {
      bytes[position++] = (value % 128) + 128;
      value = Math.floor(value / 128);
    }
    bytes[position++] = value;
  }
  function align(width: number): void {
    reserve(width);
    while (position % width !== 0) bytes[position++] = 0;
  }
  function float(value: number): void {
    align(8);
    reserve(8);
    sink.writeFloat64(position, value);
    position += 8;
  }
  function string(value: string): void {
    const units = value.length;
    varint(units);
    reserve(units * 2);
    if (units <= inlineStringUnits)
      for (let index = 0; index < units; index++) {
        const unit = value.charCodeAt(index);
        bytes[position++] = unit % 256;
        bytes[position++] = Math.floor(unit / 256);
      }
    else {
      sink.writeString(position, value);
      position += units * 2;
    }
  }
  function taggedString(
    value: string,
    oneByteTag: number,
    twoByteTag: number,
  ): void {
    const units = value.length;
    reserve(9 + units);
    const tagAt = position;
    bytes[position++] = oneByteTag;
    varint(units);
    reserve(units);
    const copied = copyLatin1(value, 0, units, bytes, position);
    if (copied >= 0) {
      position += copied;
      return;
    }
    const twoByteNeeded = units * 2;
    reserve(twoByteNeeded);
    bytes[tagAt] = twoByteTag;
    if (units <= inlineStringUnits)
      for (let index = 0; index < units; index++) {
        const unit = value.charCodeAt(index);
        bytes[position++] = unit % 256;
        bytes[position++] = Math.floor(unit / 256);
      }
    else {
      sink.writeString(position, value);
      position += twoByteNeeded;
    }
  }
  function key(value: string): void {
    const known = keyIndices.get(value);
    if (known !== undefined) {
      tag(tagKeyReference);
      return varint(known);
    }
    keyIndices.set(value, keyIndices.size);
    taggedString(value, tagNewKey, tagTwoByteKey);
  }
  /** Enumerable own string properties from `keys`, re-checked as each is
   * visited because a getter may delete a later one. */
  function properties(
    object: ScriptObject,
    keys: readonly ScriptPropertyKey[],
  ): void {
    for (const name of keys) {
      if (typeof name !== "string") continue;
      const property = getOwnProperty<ScriptPropertyKey, unknown>(object, name);
      if (property === undefined || !property.enumerable) continue;
      key(name);
      // [[Get]] of an own data property is its value unless the object
      // overrides [[Get]]; accessors still run their getter.
      encode(
        !property.accessor && object.internalMethods?.get === undefined
          ? property.value
          : getProperty<ScriptPropertyKey, unknown>(
              object,
              name,
              object,
              hooks,
            ),
      );
    }
  }
  /** A typed program's native typed array or SharedArrayBuffer (a realm sees
   * it as an opaque reference): serialized as the realm typed array or
   * SharedArrayBuffer it reads as. A typed SharedArrayBuffer, or a view of
   * one, shares its block; any other buffer is copied whole, so the receiver
   * gets the same window. */
  function nativeTypedArray(value: unknown): boolean {
    const encodeNative = attachments?.encodeNativeBuffer;
    if (encodeNative !== undefined && value instanceof SharedArrayBuffer) {
      const grant = encodeNative(value);
      if (grant === undefined) return false;
      sharedBuffer(grant);
      return true;
    }
    let kind = -1,
      byteOffset = 0,
      length = 0,
      buffer: unknown = undefined,
      data: Uint8Array | undefined;
    if (value instanceof Uint8Array) {
      kind = 1;
      byteOffset = value.byteOffset;
      length = value.length;
      buffer = value.buffer;
      data = new Uint8Array(value.buffer);
    } else if (value instanceof Uint16Array) {
      kind = 4;
      byteOffset = value.byteOffset;
      length = value.length;
      buffer = value.buffer;
      data = new Uint8Array(value.buffer);
    } else if (value instanceof Uint32Array) {
      kind = 6;
      byteOffset = value.byteOffset;
      length = value.length;
      buffer = value.buffer;
      data = new Uint8Array(value.buffer);
    } else if (value instanceof Float64Array) {
      kind = 9;
      byteOffset = value.byteOffset;
      length = value.length;
      buffer = value.buffer;
      data = new Uint8Array(value.buffer);
    }
    if (data === undefined) return false;
    const grant = encodeNative?.(buffer);
    tag(tagTypedArray);
    tag(kind);
    tag(0);
    varint(byteOffset);
    varint(length + 1);
    objectCount++;
    if (grant !== undefined) {
      sharedBuffer(grant);
      return true;
    }
    objectCount++;
    tag(tagArrayBuffer);
    varint(data.length);
    varint(data.length);
    reserve(data.length);
    bytes.set(data, position);
    position += data.length;
    return true;
  }
  /** The realm SharedArrayBuffer of a typed program's shared block, once
   * per message. */
  function sharedBuffer(grant: number): void {
    const seen = nativeBuffers.get(grant);
    if (seen !== undefined) {
      tag(tagReference);
      varint(seen);
      return;
    }
    nativeBuffers.set(grant, objectCount++);
    tag(tagAttachment);
    varint(grant);
  }
  function encode(value: unknown): void {
    if (value === undefined) return tag(tagUndefined);
    if (value === null) return tag(tagNull);
    if (typeof value === "boolean") return tag(value ? tagTrue : tagFalse);
    if (typeof value === "number") {
      // int32 values other than -0 take a zigzag varint; the rest binary64.
      if ((value | 0) === value && (value !== 0 || 1 / value > 0)) {
        tag(tagInt32);
        return varint(value >= 0 ? value * 2 : -value * 2 - 1);
      }
      tag(tagDouble);
      return float(value);
    }
    if (typeof value === "string") {
      if (value.length >= sharedStringUnits) {
        const grant = attachments?.encodeString?.(value);
        if (grant !== undefined) {
          tag(tagSharedString);
          return varint(grant);
        }
      }
      return taggedString(value, tagOneByteString, tagString);
    }
    const big = viewBigIntValue(value);
    if (big !== undefined) {
      const digits = bigIntToString(big, 10);
      if (digits === undefined) throw "WORKER_CLONE_BIGINT_RADIX";
      tag(tagBigInt);
      return string(digits);
    }
    const object = viewObjectValue(value, realm.objectPrototype);
    // A typed program's native typed array is opaque to the realm, so only a
    // value that is not a realm object pays for its instanceof tests.
    if (object === undefined) {
      if (nativeTypedArray(value)) return;
      return throwWorkerCloneError(realm, "The value could not be cloned");
    }
    let identity = exoticSlots(object).internalIdentity;
    if (identity === 0) {
      identity = realm.agent.nextObjectIdentity++;
      ensureExoticSlots(object).internalIdentity = identity;
    }
    const seen = objects.get(identity);
    if (seen !== undefined) {
      tag(tagReference);
      return varint(seen);
    }
    objects.set(identity, objectCount++);
    const grant = attachments?.encode?.(object);
    if (grant !== undefined) {
      tag(tagAttachment);
      return varint(grant);
    }
    if (unsupportedObject(object))
      return throwWorkerCloneError(realm, "The object could not be cloned");
    const primitive = exoticSlots(object).internalPrimitiveData;
    if (primitive !== undefined) {
      if (primitive.kind === "symbol")
        return throwWorkerCloneError(
          realm,
          "A boxed Symbol could not be cloned",
        );
      tag(tagBoxed);
      return encode(primitive.value);
    }
    const typed = exoticSlots(object).internalTypedArrayData;
    if (typed !== undefined) {
      if (typedArrayWindow(typed) === undefined)
        return throwWorkerCloneError(realm, "The typed array is out of bounds");
      const kind = elementKinds.indexOf(typed.kind);
      if (kind < 0) throw "WORKER_CLONE_ELEMENT_KIND";
      tag(tagTypedArray);
      tag(kind);
      tag(typed.endian === "little" ? 0 : 1);
      varint(typed.byteOffset);
      // Zero marks a length-tracking view; others store length + 1.
      varint(typed.length === undefined ? 0 : typed.length + 1);
      return encode(typed.buffer);
    }
    const view = exoticSlots(object).internalDataViewData;
    if (view !== undefined) {
      if (
        bufferStorageWindow(
          view.storage,
          view.byteOffset,
          view.byteLength,
          1,
        ) === undefined
      )
        return throwWorkerCloneError(realm, "The DataView is out of bounds");
      tag(tagDataView);
      varint(view.byteOffset);
      varint(view.byteLength === undefined ? 0 : view.byteLength + 1);
      return encode(view.buffer);
    }
    if (exoticSlots(object).internalErrorData) {
      tag(tagError);
      const name = getProperty<ScriptPropertyKey, unknown>(
        object,
        "name",
        object,
        hooks,
      );
      string(typeof name === "string" ? name : "Error");
      const message = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        "message",
      );
      let text: string | undefined = undefined;
      if (message !== undefined && !message.accessor) {
        const coerced = stringValue(message.value, hooks, realm);
        if (coerced.error !== "none") throw createRuntimeError(realm, "type");
        text = coerced.value;
      }
      const stack = exoticSlots(object).internalErrorStack;
      const cause = getOwnProperty<ScriptPropertyKey, unknown>(object, "cause");
      const hasCause = cause !== undefined && !cause.accessor;
      tag(
        (text === undefined ? 0 : 1) +
          (stack === undefined ? 0 : 2) +
          (hasCause ? 4 : 0),
      );
      if (text !== undefined) string(text);
      if (stack !== undefined) string(stack);
      if (cause !== undefined && !cause.accessor) encode(cause.value);
      return;
    }
    const map = exoticSlots(object).internalMapData;
    const set = exoticSlots(object).internalSetData;
    if (map !== undefined || set !== undefined) {
      if (map !== undefined && map.numDirty) syncScriptMapNumbers(map);
      let head = map === undefined ? set?.head : map.head;
      const keys: unknown[] = [];
      const values: unknown[] = [];
      while (head !== undefined) {
        keys.push(head.key);
        if (map !== undefined) values.push(head.value);
        head = head.next;
      }
      tag(map === undefined ? tagSet : tagMap);
      varint(keys.length);
      for (let index = 0; index < keys.length; index++) {
        encode(keys[index]);
        if (map !== undefined) encode(values[index]);
      }
      return;
    }
    const date = exoticSlots(object).internalDateValue;
    if (date !== undefined) {
      tag(tagDate);
      return float(date);
    }
    const expression = exoticSlots(object).internalRegExpData;
    if (expression !== undefined) {
      tag(tagRegExp);
      string(expression.originalSource);
      return string(expression.originalFlags);
    }
    const storage = exoticSlots(object).internalArrayBufferData;
    if (storage !== undefined) {
      const data = byteStorageData(storage);
      if (data === undefined)
        return throwWorkerCloneError(realm, "The ArrayBuffer is detached");
      tag(storage.resizable ? tagResizableArrayBuffer : tagArrayBuffer);
      varint(storage.maxByteLength);
      varint(data.length);
      reserve(data.length);
      bytes.set(data, position);
      position += data.length;
      return;
    }
    if (object.internalArrayData) {
      const length = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        "length",
      )?.value;
      if (typeof length !== "number") throw "WORKER_CLONE_ARRAY_LENGTH";
      const elements = object.internalArrayElements;
      if (elements === undefined) {
        tag(tagSparseArray);
        varint(length);
        properties(
          object,
          ownKeys<ScriptPropertyKey, unknown>(object, scriptPropertyKeyOrder),
        );
        return tag(endSparseArray);
      }
      // Packed: indices 0..count-1 precede every map key, as in
      // [[OwnPropertyKeys]], and none of them is created on the way.
      const count = arrayElementCount<ScriptPropertyKey, unknown>(elements);
      const rest = propertyMapKeys<ScriptPropertyKey, unknown>(
        object,
        scriptPropertyKeyOrder,
      );
      if (elements.values === undefined) {
        const numbers = elements.numbers;
        // Encoding numbers runs no script, so the run is one snapshot.
        tag(tagNumberArray);
        varint(length);
        varint(count);
        align(8);
        reserve(count * 8);
        for (let index = 0; index < count; index++) {
          sink.writeFloat64(position, numbers[index] ?? 0);
          position += 8;
        }
      } else {
        tag(tagDenseArray);
        varint(length);
        varint(count);
        for (let index = 0; index < count; index++) {
          // A getter met earlier may have removed or redefined this index.
          const current = object.internalArrayElements;
          if (
            current !== undefined &&
            index < arrayElementCount<ScriptPropertyKey, unknown>(current)
          ) {
            encode(
              readArrayElement<ScriptPropertyKey, unknown>(current, index),
            );
            continue;
          }
          const name = realm.arrayHooks.indexKey(index);
          const property = getOwnProperty<ScriptPropertyKey, unknown>(
            object,
            name,
          );
          if (property === undefined || !property.enumerable) {
            tag(tagHole);
            continue;
          }
          encode(
            getProperty<ScriptPropertyKey, unknown>(
              object,
              name,
              object,
              hooks,
            ),
          );
        }
      }
      properties(object, rest);
      return tag(endDenseArray);
    }
    tag(tagObject);
    properties(
      object,
      ownKeys<ScriptPropertyKey, unknown>(object, scriptPropertyKeyOrder),
    );
    tag(endObject);
  }
  encode(value);
  return position;
}

export function deserializeWorkerValue(
  source: WorkerCloneSource,
  start: number,
  end: number,
  realm: ErrorRealm,
  attachments?: WorkerCloneAttachments,
): unknown {
  // A lone primitive decodes without the reference tables; anything else,
  // including a malformed payload, takes the graph decoder.
  const bytes = source.bytes;
  if (start >= 0 && end <= bytes.length && start < end) {
    const kind = bytes[start];
    if (end === start + 1) {
      if (kind === tagUndefined) return undefined;
      if (kind === tagNull) return null;
      if (kind === tagTrue) return true;
      if (kind === tagFalse) return false;
    } else if (kind === tagInt32 && end - start <= 6) {
      let zigzag = 0,
        scale = 1,
        position = start + 1;
      for (; position < end; position++) {
        const byte = bytes[position] ?? 0;
        zigzag += (byte % 128) * scale;
        scale *= 128;
        if (byte < 128) break;
      }
      if (position === end - 1 && zigzag <= 4294967295)
        return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
    } else if (kind === tagDouble) {
      const value = Math.ceil((start + 1) / 8) * 8;
      if (end === value + 8) {
        let padded = true;
        for (let at = start + 1; at < value; at++)
          if (bytes[at] !== 0) padded = false;
        if (padded) return source.readFloat64(value);
      }
    } else if (kind === tagOneByteString) {
      let units = 0,
        scale = 1,
        position = start + 1;
      while (position < end) {
        const byte = bytes[position++] ?? 0;
        units += (byte % 128) * scale;
        if (byte < 128) {
          if (Number.isSafeInteger(units) && position + units === end)
            return latin1Text(bytes, position, end);
          break;
        }
        scale *= 128;
        if (scale > 9007199254740992) break;
      }
    } else if (kind === tagString) {
      let units = 0,
        scale = 1,
        position = start + 1;
      while (position < end) {
        const byte = bytes[position++] ?? 0;
        units += (byte % 128) * scale;
        if (byte < 128) {
          if (Number.isSafeInteger(units) && position + units * 2 === end)
            return source.readString(position, units);
          break;
        }
        scale *= 128;
        if (scale > 9007199254740992) break;
      }
    } else if (kind === tagSharedString) {
      let grant = 0,
        scale = 1,
        position = start + 1;
      while (position < end) {
        const byte = bytes[position++] ?? 0;
        grant += (byte % 128) * scale;
        if (byte < 128) {
          if (position === end && Number.isSafeInteger(grant)) {
            const decoded = attachments?.decodeString?.(grant);
            if (decoded !== undefined) return decoded;
          }
          break;
        }
        scale *= 128;
        if (scale > 9007199254740992) break;
      }
    }
  }
  return deserializeWorkerGraph(source, start, end, realm, attachments);
}
function deserializeWorkerGraph(
  source: WorkerCloneSource,
  start: number,
  end: number,
  realm: ErrorRealm,
  attachments?: WorkerCloneAttachments,
): unknown {
  const objects: (ScriptObject | undefined)[] = [];
  const keys: string[] = [];
  const hooks = realm.objectHooks;
  const bytes = source.bytes;
  if (start < 0 || end > bytes.length || start > end)
    throw "WORKER_CLONE_WINDOW_INVARIANT";
  let position = start;
  function invalid(): never {
    return throwWorkerCloneError(realm, "Invalid worker clone payload");
  }
  function next(): number {
    if (position >= end) return invalid();
    return bytes[position++] ?? 0;
  }
  function varint(): number {
    let value = 0,
      scale = 1;
    for (;;) {
      const byte = next();
      value += (byte % 128) * scale;
      if (byte < 128) break;
      scale *= 128;
      if (scale > 9007199254740992) return invalid();
    }
    return Number.isSafeInteger(value) ? value : invalid();
  }
  function align(width: number): void {
    while (position % width !== 0) if (next() !== 0) invalid();
  }
  function float(): number {
    align(8);
    if (end - position < 8) return invalid();
    const value = source.readFloat64(position);
    position += 8;
    return value;
  }
  function oneByteString(): string {
    const units = varint();
    if (units > end - position) return invalid();
    const value = latin1Text(bytes, position, position + units);
    position += units;
    return value;
  }
  function string(): string {
    const units = varint();
    if (units > (end - position) / 2) return invalid();
    const value = source.readString(position, units);
    position += units * 2;
    return value;
  }
  function key(): string {
    const kind = next();
    if (kind === tagNewKey) {
      const value = oneByteString();
      keys.push(value);
      return value;
    }
    if (kind === tagTwoByteKey) {
      const value = string();
      keys.push(value);
      return value;
    }
    if (kind !== tagKeyReference) return invalid();
    const value = keys[varint()];
    return value === undefined ? invalid() : value;
  }
  function remember(object: ScriptObject): ScriptObject {
    objects.push(object);
    return object;
  }
  function define(
    object: ScriptObject,
    name: ScriptPropertyKey,
    value: unknown,
  ): void {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        object,
        name,
        value,
        hooks,
      )
    )
      invalid();
  }
  /** Properties up to `terminator`. */
  function properties(object: ScriptObject, terminator: number): ScriptObject {
    for (;;) {
      if (position < end && bytes[position] === terminator) {
        position++;
        return object;
      }
      const name = key();
      define(object, name, decode());
    }
  }
  function decode(): unknown {
    const kind = next();
    if (kind === tagUndefined) return undefined;
    if (kind === tagNull) return null;
    if (kind === tagTrue) return true;
    if (kind === tagFalse) return false;
    if (kind === tagInt32) {
      const zigzag = varint();
      if (zigzag > 4294967295) return invalid();
      return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
    }
    if (kind === tagDouble) return float();
    if (kind === tagOneByteString) return oneByteString();
    if (kind === tagString) return string();
    if (kind === tagSharedString) {
      const value = attachments?.decodeString?.(varint());
      return value === undefined ? invalid() : value;
    }
    if (kind === tagBigInt) {
      const value = bigIntFromString(string());
      return value === undefined ? invalid() : value;
    }
    if (kind === tagReference) {
      const value = objects[varint()];
      return value === undefined ? invalid() : value;
    }
    if (kind === tagAttachment) {
      const value = attachments?.decode?.(varint());
      return value === undefined ? invalid() : remember(value);
    }
    if (kind === tagDate) {
      const date = createObject<ScriptPropertyKey, unknown>(
        realm.datePrototype,
      );
      ensureExoticSlots(date).internalDateValue = float();
      return remember(date);
    }
    if (kind === tagBoxed) {
      const value = decode();
      if (
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        typeof value !== "string" &&
        viewBigIntValue(value) === undefined
      )
        return invalid();
      return remember(toObjectValue(value, realm, hooks));
    }
    if (kind === tagRegExp)
      return remember(createRegExpLiteral(string(), string(), realm, hooks));
    if (kind === tagError) {
      const error = remember(createRuntimeError(realm, errorKind(string())));
      const flags = next();
      if (flags > 7) return invalid();
      if ((flags & 1) !== 0)
        builtinProperty(error, "message", string(), true, false, hooks);
      ensureExoticSlots(error).internalErrorStack =
        (flags & 2) !== 0 ? string() : undefined;
      if ((flags & 4) !== 0)
        builtinProperty(error, "cause", decode(), true, false, hooks);
      return error;
    }
    if (kind === tagTypedArray || kind === tagDataView) {
      const index = objects.length;
      objects.push(undefined);
      const element = kind === tagTypedArray ? elementKinds[next()] : undefined;
      const order = kind === tagTypedArray ? next() : 0;
      if ((kind === tagTypedArray && element === undefined) || order > 1)
        return invalid();
      const byteOffset = varint();
      const size = varint();
      const length = size === 0 ? undefined : size - 1;
      const buffer = viewObjectValue(decode(), realm.objectPrototype);
      if (buffer === undefined) return invalid();
      const storage =
        exoticSlots(buffer).internalArrayBufferData ??
        exoticSlots(buffer).internalSharedArrayBufferData;
      if (storage === undefined) return invalid();
      let object: ScriptObject;
      if (element === undefined) {
        if (bufferStorageWindow(storage, byteOffset, length, 1) === undefined)
          return invalid();
        object = createObject<ScriptPropertyKey, unknown>(
          realm.dataViewPrototype,
        );
        ensureExoticSlots(object).internalArrayBufferView = true;
        ensureExoticSlots(object).internalDataViewData = {
          buffer,
          storage,
          byteOffset,
          byteLength: length,
        };
      } else {
        const data: TypedArrayData = {
          buffer,
          storage,
          byteOffset,
          length,
          kind: element,
          endian: order === 0 ? "little" : "big",
        };
        if (typedArrayWindow(data) === undefined) return invalid();
        object = createTypedArrayView(
          realm.typedArrayPrototypes.get(element),
          data,
          realm,
          hooks,
        );
      }
      objects[index] = object;
      return object;
    }
    if (kind === tagArrayBuffer || kind === tagResizableArrayBuffer) {
      const maximum = varint(),
        length = varint();
      if (length > end - position) return invalid();
      const storage = createByteStorage(
        length,
        maximum,
        kind === tagResizableArrayBuffer,
        realm.bufferMaxBytes,
        realm.bufferAllocator,
      );
      if (!storage.ok) return invalid();
      const data = byteStorageData(storage.value);
      if (data === undefined) return invalid();
      data.set(bytes.subarray(position, position + length));
      position += length;
      const buffer = createObject<ScriptPropertyKey, unknown>(
        realm.arrayBufferPrototype,
      );
      ensureExoticSlots(buffer).internalArrayBufferData = storage.value;
      return remember(buffer);
    }
    if (kind === tagSet || kind === tagMap) {
      const isMap = kind === tagMap;
      const object = remember(
        createObject<ScriptPropertyKey, unknown>(
          isMap ? realm.mapPrototype : realm.setPrototype,
        ),
      );
      const data = createSetData();
      if (isMap) ensureExoticSlots(object).internalMapData = data;
      else ensureExoticSlots(object).internalSetData = data;
      const length = varint();
      for (let index = 0; index < length; index++) {
        const key = decode();
        setScriptMap(data, key, isMap ? decode() : key);
      }
      return object;
    }
    if (kind === tagDenseArray || kind === tagNumberArray) {
      const length = varint(),
        count = varint();
      if (count > length) return invalid();
      const object = remember(
        createArrayObject<ScriptPropertyKey, unknown>(
          length,
          realm.arrayPrototype,
          realm.arrayHooks,
          hooks,
        ),
      );
      const elements = object.internalArrayElements;
      if (elements === undefined) throw "WORKER_CLONE_ARRAY_INVARIANT";
      if (kind === tagNumberArray) {
        align(8);
        if (count > (end - position) / 8) return invalid();
        const numbers =
          count === 0
            ? noNumbers
            : new Float64Array(count < firstCapacity ? firstCapacity : count);
        for (let index = 0; index < count; index++) {
          numbers[index] = source.readFloat64(position);
          position += 8;
        }
        elements.numbers = numbers;
        elements.numberCount = count;
      } else {
        // Elements append to packed storage until the first hole; later
        // ones are ordinary index properties.
        let packed = true;
        for (let index = 0; index < count; index++) {
          if (position < end && bytes[position] === tagHole) {
            position++;
            packed = false;
            continue;
          }
          const value = decode();
          const current = object.internalArrayElements;
          if (
            packed &&
            current !== undefined &&
            arrayElementCount<ScriptPropertyKey, unknown>(current) === index
          )
            writeArrayElement<ScriptPropertyKey, unknown>(
              current,
              index,
              value,
            );
          else define(object, realm.arrayHooks.indexKey(index), value);
        }
      }
      return properties(object, endDenseArray);
    }
    if (kind === tagSparseArray)
      return properties(
        remember(
          createArrayObject<ScriptPropertyKey, unknown>(
            varint(),
            realm.arrayPrototype,
            realm.arrayHooks,
            hooks,
          ),
        ),
        endSparseArray,
      );
    if (kind === tagObject)
      return properties(
        remember(
          createObject<ScriptPropertyKey, unknown>(realm.objectPrototype),
        ),
        endObject,
      );
    return invalid();
  }
  const result = decode();
  return position === end ? result : invalid();
}
