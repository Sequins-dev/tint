import { copyLatin1, latin1Text } from "@tint/foundation/text/latin1";
import { setScriptMap, syncScriptMapNumbers } from "./collection-data.ts";
import {
  createByteStorage,
  byteStorageData,
  detachByteStorage,
  type ByteStorage,
} from "../bytes/index.ts";
import {
  allocGeneralRefs,
  arrayElementCount,
  ensureGeneralNumbers,
  firstCapacity,
  noGeneralRefs,
  noGeneralTags,
  noNumbers,
  readArrayElement,
  writeGeneralSlot,
  type ArrayElements,
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
import { constructObjectValueOrThrow } from "./fused-results.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObjectLiteralSite,
  ensureExoticSlots,
  exoticSlots,
  createDataProperty,
  createObject,
  getOwnProperty,
  getProperty,
  ownKeys,
  propertyEnumerable,
  propertyMapKeys,
  setFastValue,
  storedValue,
  type ObjectInternalMethods,
  type ObjectHooks,
  type ObjectLiteralSite,
  type OrdinaryObject,
  type OrdinaryPropertyShape,
  objectFlagArrayData,
  objectFlagDictionary,
  objectFlagExtensible,
  objectFlagUsedAsPrototype,
  objectFlagsPackedArray,
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
import { arrayLikeValues } from "./array-like.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type ScriptShape = OrdinaryPropertyShape<ScriptPropertyKey, unknown>;

interface EncodedShape {
  readonly shape: ScriptShape;
  readonly id: number;
  readonly keys: readonly string[];
  readonly slots: readonly number[];
  readonly contiguous: boolean;
}

/** Guards temporary negative internalPropertyEpoch marks and pooled scratch
 * tables against re-entrant serialization triggered by a getter. */
let activeFastMark = false;
const fastMarkBase = 1000000000;
const recentStringSlots = 32;
const recentStringMaxUnits = 32;
const pooledMarkedObjects: ScriptObject[] = [];
const pooledMarkedEpochs: number[] = [];
const pooledMarkedIndices: number[] = [];
const pooledEncodedShapes: EncodedShape[] = [];
const pooledEncodeStrings: (string | undefined)[] = [];
let activeFastDecode = false;
const pooledDecodeObjects: (ScriptObject | undefined)[] = [];
const pooledDecodeKeys: string[] = [];
const pooledDecodeShapes: ObjectLiteralSite[] = [];
const pooledDecodeStrings: (string | undefined)[] = [];

function clearRecentStrings(table: (string | undefined)[]): void {
  if (table.length < recentStringSlots) {
    while (table.length < recentStringSlots) table.push(undefined);
    return;
  }
  for (let index = 0; index < recentStringSlots; index++)
    table[index] = undefined;
}

/** Fresh packed array when `prototype` is already marked as a prototype. */
function createMarkedPackedArrayObject(
  prototype: ScriptObject,
  shape: ScriptShape | undefined,
  elements: ArrayElements<ScriptPropertyKey, unknown>,
  methods: ObjectInternalMethods<ScriptPropertyKey, unknown>,
): ScriptObject {
  return {
    internalShape: shape,
    prototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: elements,
    internalMethods: methods,
    internalRareSlots: undefined,
    internalValue0: undefined,
    internalValue1: undefined,
    internalValue2: undefined,
    internalValue3: undefined,
    internalValue4: undefined,
    internalValue5: undefined,
    internalValue6: undefined,
    internalValue7: undefined,
  };
}

/** Fresh ordinary object when `prototype` is already marked as a prototype. */
function createMarkedOrdinaryObject(
  prototype: ScriptObject,
  shape: ScriptShape | undefined,
  epoch: number,
): ScriptObject {
  return {
    internalShape: shape,
    prototype,
    internalFlags: objectFlagExtensible,
    internalPropertyEpoch: epoch,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: undefined,
    internalMethods: undefined,
    internalRareSlots: undefined,
    internalValue0: undefined,
    internalValue1: undefined,
    internalValue2: undefined,
    internalValue3: undefined,
    internalValue4: undefined,
    internalValue5: undefined,
    internalValue6: undefined,
    internalValue7: undefined,
  };
}

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
  const constructor = realm.constructors.get("dom-exception");
  if (constructor !== undefined)
    throw constructObjectValueOrThrow(
      realm,
      constructor,
      [message, "DataCloneError"],
      realm.objectPrototype,
    );
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
    object.internalRareSlots?.internalCall !== undefined ||
    object.internalRareSlots?.internalConstruct !== undefined ||
    (rare !== undefined && rare.internalArgumentsData)
  )
    return true;
  const exotic = object.internalRareSlots?.internalExoticSlots;
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
const tagRecentString = 114; // r: 1-byte slot in the 32-entry short-string cache
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
const tagNewShape = 83; // S: varint count, count keys, then count values
const tagShapeObject = 113; // q: varint shape index, then count values
const tagOmitted = 127; // DEL: property removed before read by a nested getter
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
  let objects: Map<number, number> | undefined = undefined;
  const useFastMark = !activeFastMark;
  const markedObjects: ScriptObject[] = useFastMark ? pooledMarkedObjects : [];
  const markedEpochs: number[] = useFastMark ? pooledMarkedEpochs : [];
  const markedIndices: number[] = useFastMark ? pooledMarkedIndices : [];
  const encodedShapes: EncodedShape[] = useFastMark ? pooledEncodedShapes : [];
  const recentStrings: (string | undefined)[] = useFastMark
    ? pooledEncodeStrings
    : [];
  if (recentStrings.length < recentStringSlots)
    clearRecentStrings(recentStrings);
  // The decoder's object indices: one per object, and a native typed
  // array's view and buffer take one each.
  let objectCount = 0;
  // Object indices of the shared native buffers already serialized, by
  // grant.
  let nativeBuffers: Map<number, number> | undefined = undefined;
  let keyIndices: Map<string, number> | undefined = undefined;
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
    if (value >= 0 && value < 128 && (value | 0) === value) {
      if (position >= bytes.length) reserve(1);
      bytes[position++] = value;
      return;
    }
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
    if (position + 16 > bytes.length) reserve(16);
    while ((position & 7) !== 0) bytes[position++] = 0;
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
    if (units < 128) {
      if (position + 2 + units > bytes.length) reserve(2 + units);
      const tagAt = position;
      bytes[position++] = oneByteTag;
      bytes[position++] = units;
      const copied = copyLatin1(value, 0, units, bytes, position);
      if (copied >= 0) {
        position += copied;
        return;
      }
      const twoByteNeeded = units * 2;
      if (position + twoByteNeeded > bytes.length) reserve(twoByteNeeded);
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
      return;
    }
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
    sink.writeString(position, value);
    position += twoByteNeeded;
  }
  function key(value: string): void {
    let table = keyIndices;
    if (table === undefined) {
      table = new Map<string, number>();
      keyIndices = table;
    }
    const known = table.get(value);
    if (known !== undefined) {
      tag(tagKeyReference);
      return varint(known);
    }
    table.set(value, table.size);
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
    let table = nativeBuffers;
    if (table === undefined) {
      table = new Map<number, number>();
      nativeBuffers = table;
    }
    const seen = table.get(grant);
    if (seen !== undefined) {
      tag(tagReference);
      varint(seen);
      return;
    }
    table.set(grant, objectCount++);
    tag(tagAttachment);
    varint(grant);
  }
  function encodeArray(object: ScriptObject): void {
    const elements = object.internalArrayElements;
    if (elements === undefined) {
      const length = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        "length",
      )?.value;
      if (typeof length !== "number") throw "WORKER_CLONE_ARRAY_LENGTH";
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
    const length = elements.length;
    const count = arrayElementCount<ScriptPropertyKey, unknown>(elements);
    const arrayShape = object.internalShape;
    const hasExpando =
      (object.internalFlags & objectFlagDictionary) !== 0 ||
      object.internalMethods !== undefined ||
      object.internalRareSlots?.properties !== undefined ||
      (arrayShape !== undefined && arrayShape.keys.length > 0);
    const rest = hasExpando
      ? propertyMapKeys<ScriptPropertyKey, unknown>(
          object,
          scriptPropertyKeyOrder,
        )
      : undefined;
    if (elements.generalCount === 0) {
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
          encode(readArrayElement<ScriptPropertyKey, unknown>(current, index));
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
          getProperty<ScriptPropertyKey, unknown>(object, name, object, hooks),
        );
      }
    }
    if (rest !== undefined) properties(object, rest);
    tag(endDenseArray);
  }
  function encodeOrdinaryObject(object: ScriptObject): void {
    const shape = object.internalShape;
    if (
      (object.internalFlags & objectFlagDictionary) === 0 &&
      object.internalMethods === undefined &&
      object.internalRareSlots?.properties === undefined &&
      shape !== undefined
    ) {
      const shapeKeys = shape.keys;
      if (shapeKeys.length === 0) {
        tag(tagObject);
        return tag(endObject);
      }
      let entry: EncodedShape | undefined = undefined;
      for (let index = 0; index < encodedShapes.length; index++) {
        const candidate = encodedShapes[index];
        if (candidate !== undefined && candidate.shape === shape) {
          entry = candidate;
          break;
        }
      }
      if (entry === undefined) {
        const keys: string[] = [];
        const slots: number[] = [];
        const kinds = shape.kinds;
        let contiguous = true;
        for (let index = 0; index < shapeKeys.length; index++) {
          const name = shapeKeys[index];
          if (
            typeof name === "string" &&
            ((kinds[index] ?? 0) & propertyEnumerable) !== 0
          ) {
            if (slots.length !== index) contiguous = false;
            keys.push(name);
            slots.push(index);
          }
        }
        if (keys.length === 0) {
          tag(tagObject);
          return tag(endObject);
        }
        if (slots.length > 8) contiguous = false;
        entry = { shape, id: encodedShapes.length, keys, slots, contiguous };
        encodedShapes.push(entry);
        tag(tagNewShape);
        varint(keys.length);
        for (let index = 0; index < keys.length; index++) {
          const name = keys[index];
          if (name === undefined) throw "WORKER_CLONE_SHAPE_KEY";
          key(name);
        }
      } else {
        if (entry.id < 128) {
          if (position + 2 > bytes.length) reserve(2);
          bytes[position++] = tagShapeObject;
          bytes[position++] = entry.id;
        } else {
          tag(tagShapeObject);
          varint(entry.id);
        }
      }
      const slots = entry.slots;
      const keys = entry.keys;
      const slotCount = slots.length;
      if (entry.contiguous) {
        if (slotCount <= 4) {
          encode(object.internalValue0);
          if (slotCount >= 2) {
            if (
              object.internalShape === shape &&
              (object.internalFlags & objectFlagDictionary) === 0 &&
              object.internalRareSlots?.properties === undefined
            )
              encode(object.internalValue1);
            else encodeMutatedSlot(object, keys, 1);
          }
          if (slotCount >= 3) {
            if (
              object.internalShape === shape &&
              (object.internalFlags & objectFlagDictionary) === 0 &&
              object.internalRareSlots?.properties === undefined
            )
              encode(object.internalValue2);
            else encodeMutatedSlot(object, keys, 2);
          }
          if (slotCount === 4) {
            if (
              object.internalShape === shape &&
              (object.internalFlags & objectFlagDictionary) === 0 &&
              object.internalRareSlots?.properties === undefined
            )
              encode(object.internalValue3);
            else encodeMutatedSlot(object, keys, 3);
          }
          return;
        }
        for (let index = 0; index < slotCount; index++) {
          if (
            object.internalShape === shape &&
            (object.internalFlags & objectFlagDictionary) === 0 &&
            object.internalRareSlots?.properties === undefined
          ) {
            let raw: unknown;
            switch (index) {
              case 0:
                raw = object.internalValue0;
                break;
              case 1:
                raw = object.internalValue1;
                break;
              case 2:
                raw = object.internalValue2;
                break;
              case 3:
                raw = object.internalValue3;
                break;
              case 4:
                raw = object.internalValue4;
                break;
              case 5:
                raw = object.internalValue5;
                break;
              case 6:
                raw = object.internalValue6;
                break;
              default:
                raw = object.internalValue7;
                break;
            }
            encode(raw);
          } else {
            encodeMutatedSlot(object, keys, index);
          }
        }
        return;
      }
      for (let index = 0; index < slotCount; index++) {
        if (
          object.internalShape === shape &&
          (object.internalFlags & objectFlagDictionary) === 0 &&
          object.internalRareSlots?.properties === undefined
        ) {
          const slot = slots[index];
          if (slot === undefined) throw "WORKER_CLONE_SHAPE_SLOT";
          const raw = storedValue<ScriptPropertyKey, unknown>(object, slot);
          encode(raw === undefined ? shape.undefinedValue : raw);
        } else {
          encodeMutatedSlot(object, keys, index);
        }
      }
      return;
    }
    tag(tagObject);
    properties(
      object,
      ownKeys<ScriptPropertyKey, unknown>(object, scriptPropertyKeyOrder),
    );
    tag(endObject);
  }
  function encodeMutatedSlot(
    object: ScriptObject,
    keys: readonly string[],
    index: number,
  ): void {
    const name = keys[index];
    if (name === undefined) throw "WORKER_CLONE_SHAPE_KEY";
    const property = getOwnProperty<ScriptPropertyKey, unknown>(object, name);
    if (property === undefined || !property.enumerable) {
      tag(tagOmitted);
      return;
    }
    encode(
      !property.accessor
        ? property.value
        : getProperty<ScriptPropertyKey, unknown>(object, name, object, hooks),
    );
  }
  function encode(value: unknown): void {
    if (typeof value === "string") {
      const units = value.length;
      if (units >= 1 && units <= recentStringMaxUnits) {
        const slot =
          ((units << 3) ^
            (value.charCodeAt(0) << 1) ^
            value.charCodeAt(units - 1)) &
          31;
        if (recentStrings[slot] === value) {
          if (position + 2 > bytes.length) reserve(2);
          bytes[position++] = tagRecentString;
          bytes[position++] = slot;
          return;
        }
        if (position + 2 + units > bytes.length) reserve(2 + units);
        const tagAt = position;
        bytes[position++] = tagOneByteString;
        bytes[position++] = units;
        const copied = copyLatin1(value, 0, units, bytes, position);
        if (copied >= 0) {
          position += copied;
          recentStrings[slot] = value;
          return;
        }
        const twoByteNeeded = units * 2;
        if (position + twoByteNeeded > bytes.length) reserve(twoByteNeeded);
        bytes[tagAt] = tagString;
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
        return;
      }
      if (units >= sharedStringUnits) {
        const grant = attachments?.encodeString?.(value);
        if (grant !== undefined) {
          tag(tagSharedString);
          return varint(grant);
        }
      }
      return taggedString(value, tagOneByteString, tagString);
    }
    if (typeof value === "number") {
      // int32 values other than -0 take a zigzag varint; the rest binary64.
      if ((value | 0) === value && (value !== 0 || 1 / value > 0)) {
        if (value >= 0 && value < 64) {
          if (position + 2 > bytes.length) reserve(2);
          bytes[position++] = tagInt32;
          bytes[position++] = value << 1;
          return;
        }
        tag(tagInt32);
        return varint(value >= 0 ? value * 2 : -value * 2 - 1);
      }
      tag(tagDouble);
      return float(value);
    }
    if (typeof value === "boolean") return tag(value ? tagTrue : tagFalse);
    if (value === undefined) return tag(tagUndefined);
    if (value === null) return tag(tagNull);
    const object = viewObjectValue(value, realm.objectPrototype);
    // A typed program's native typed array is opaque to the realm, so only a
    // value that is not a realm object pays for BigInt / instanceof tests.
    if (object === undefined) {
      const big = viewBigIntValue(value);
      if (big !== undefined) {
        const digits = bigIntToString(big, 10);
        if (digits === undefined) throw "WORKER_CLONE_BIGINT_RADIX";
        tag(tagBigInt);
        return string(digits);
      }
      if (nativeTypedArray(value)) return;
      return throwWorkerCloneError(realm, "The value could not be cloned");
    }
    if (useFastMark) {
      const epoch = object.internalPropertyEpoch;
      if (epoch <= -fastMarkBase) {
        const slot = -epoch - fastMarkBase;
        let seenIndex =
          markedObjects[slot] === object ? markedIndices[slot] : undefined;
        if (seenIndex === undefined) {
          for (let index = 0; index < markedObjects.length; index++) {
            if (markedObjects[index] === object) {
              seenIndex = markedIndices[index];
              break;
            }
          }
        }
        if (seenIndex !== undefined) {
          tag(tagReference);
          return varint(seenIndex);
        }
      }
      const exoticFast = object.internalRareSlots?.internalExoticSlots;
      if (
        exoticFast === undefined &&
        (object.internalFlags & objectFlagDictionary) === 0 &&
        (object.internalFlags & objectFlagUsedAsPrototype) === 0 &&
        epoch >= 0
      ) {
        const slot = markedObjects.length;
        const index = objectCount++;
        markedObjects.push(object);
        markedEpochs.push(epoch);
        markedIndices.push(index);
        object.internalPropertyEpoch = -(fastMarkBase + slot);
        const rare = object.internalRareSlots;
        if (
          object.internalRareSlots?.internalCall !== undefined ||
          object.internalRareSlots?.internalConstruct !== undefined ||
          (rare !== undefined && rare.internalArgumentsData)
        )
          return throwWorkerCloneError(realm, "The object could not be cloned");
        if ((object.internalFlags & objectFlagArrayData) !== 0)
          return encodeArray(object);
        return encodeOrdinaryObject(object);
      }
    }
    const existingExotic = object.internalRareSlots?.internalExoticSlots;
    let identity =
      existingExotic === undefined ? 0 : existingExotic.internalIdentity;
    if (identity === 0) {
      identity = realm.agent.nextObjectIdentity++;
      ensureExoticSlots(object).internalIdentity = identity;
    }
    let table = objects;
    if (table === undefined) {
      table = new Map<number, number>();
      objects = table;
    }
    const seen = table.get(identity);
    if (seen !== undefined) {
      tag(tagReference);
      return varint(seen);
    }
    table.set(identity, objectCount++);
    if (existingExotic !== undefined) {
      const grant = attachments?.encode?.(object);
      if (grant !== undefined) {
        tag(tagAttachment);
        return varint(grant);
      }
      if (unsupportedObject(object))
        return throwWorkerCloneError(realm, "The object could not be cloned");
      const primitive = existingExotic.internalPrimitiveData;
      if (primitive !== undefined) {
        if (primitive.kind === "symbol")
          return throwWorkerCloneError(
            realm,
            "A boxed Symbol could not be cloned",
          );
        tag(tagBoxed);
        return encode(primitive.value);
      }
      const typed = existingExotic.internalTypedArrayData;
      if (typed !== undefined) {
        if (typedArrayWindow(typed) === undefined)
          return throwWorkerCloneError(
            realm,
            "The typed array is out of bounds",
          );
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
      const view = existingExotic.internalDataViewData;
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
      if (existingExotic.internalErrorData) {
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
        const stack = existingExotic.internalErrorStack;
        const cause = getOwnProperty<ScriptPropertyKey, unknown>(
          object,
          "cause",
        );
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
      const map = existingExotic.internalMapData;
      const set = existingExotic.internalSetData;
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
      const date = existingExotic.internalDateValue;
      if (date !== undefined) {
        tag(tagDate);
        return float(date);
      }
      const expression = existingExotic.internalRegExpData;
      if (expression !== undefined) {
        tag(tagRegExp);
        string(expression.originalSource);
        return string(expression.originalFlags);
      }
      const storage = existingExotic.internalArrayBufferData;
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
    } else {
      const rare = object.internalRareSlots;
      if (
        object.internalRareSlots?.internalCall !== undefined ||
        object.internalRareSlots?.internalConstruct !== undefined ||
        (rare !== undefined && rare.internalArgumentsData)
      )
        return throwWorkerCloneError(realm, "The object could not be cloned");
    }
    if ((object.internalFlags & objectFlagArrayData) !== 0)
      return encodeArray(object);
    encodeOrdinaryObject(object);
  }
  if (useFastMark) {
    activeFastMark = true;
    try {
      encode(value);
    } finally {
      for (let index = 0; index < markedObjects.length; index++) {
        const object = markedObjects[index];
        const saved = markedEpochs[index];
        if (object === undefined || saved === undefined) continue;
        object.internalPropertyEpoch =
          object.internalPropertyEpoch === -(fastMarkBase + index)
            ? saved
            : saved + 1;
      }
      markedObjects.length = 0;
      markedEpochs.length = 0;
      markedIndices.length = 0;
      encodedShapes.length = 0;
      clearRecentStrings(recentStrings);
      activeFastMark = false;
    }
  } else {
    encode(value);
  }
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
  const usePool = !activeFastDecode;
  const objects: (ScriptObject | undefined)[] = usePool
    ? pooledDecodeObjects
    : [];
  const keys: string[] = usePool ? pooledDecodeKeys : [];
  const shapes: ObjectLiteralSite[] = usePool ? pooledDecodeShapes : [];
  const recentStrings: (string | undefined)[] = usePool
    ? pooledDecodeStrings
    : [];
  if (recentStrings.length < recentStringSlots)
    clearRecentStrings(recentStrings);
  const hooks = realm.objectHooks;
  const objectPrototype = realm.objectPrototype;
  if ((objectPrototype.internalFlags & objectFlagUsedAsPrototype) === 0)
    createObject<ScriptPropertyKey, unknown>(objectPrototype);
  const arrayPrototype = realm.arrayPrototype;
  const arrayHooks = realm.arrayHooks;
  if (
    (arrayPrototype.internalFlags & objectFlagUsedAsPrototype) === 0 ||
    arrayHooks.internalMethods === undefined
  )
    createArrayObject<ScriptPropertyKey, unknown>(
      0,
      arrayPrototype,
      arrayHooks,
      hooks,
    );
  const maybeArrayMethods = arrayHooks.internalMethods;
  if (maybeArrayMethods === undefined)
    throw "WORKER_CLONE_ARRAY_METHODS_INVARIANT";
  const arrayMethods: ObjectInternalMethods<ScriptPropertyKey, unknown> =
    maybeArrayMethods;
  const arrayChildShape =
    arrayPrototype.internalRareSlots?.internalArrayChildShape;
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
    if (position >= end) return invalid();
    const first = bytes[position++] ?? 0;
    if (first < 128) return first;
    let value = first - 128,
      scale = 128;
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
  function decodeShapeObject(site: ObjectLiteralSite): ScriptObject {
    const shapeKeys = site.keys;
    const count = shapeKeys.length;
    const targetShape = site.shape;
    const root = site.root;
    if (
      targetShape !== undefined &&
      root !== undefined &&
      objectPrototype.internalRareSlots?.internalChildShape === root
    ) {
      const object = remember(
        createMarkedOrdinaryObject(objectPrototype, root, 0),
      );
      if (count <= 4) {
        if (count >= 1) {
          if (position < end && bytes[position] === tagOmitted) {
            position++;
            return finishOmittedShapeObject(object, shapeKeys, 0, count);
          }
          object.internalValue0 = decode();
        }
        if (count >= 2) {
          if (position < end && bytes[position] === tagOmitted) {
            position++;
            return finishOmittedShapeObject(object, shapeKeys, 1, count);
          }
          object.internalValue1 = decode();
        }
        if (count >= 3) {
          if (position < end && bytes[position] === tagOmitted) {
            position++;
            return finishOmittedShapeObject(object, shapeKeys, 2, count);
          }
          object.internalValue2 = decode();
        }
        if (count === 4) {
          if (position < end && bytes[position] === tagOmitted) {
            position++;
            return finishOmittedShapeObject(object, shapeKeys, 3, count);
          }
          object.internalValue3 = decode();
        }
        object.internalShape = targetShape;
        object.internalPropertyEpoch = count;
        return object;
      }
      for (let index = 0; index < count; index++) {
        if (position < end && bytes[position] === tagOmitted) {
          position++;
          return finishOmittedShapeObject(object, shapeKeys, index, count);
        }
        const value = decode();
        switch (index) {
          case 0:
            object.internalValue0 = value;
            break;
          case 1:
            object.internalValue1 = value;
            break;
          case 2:
            object.internalValue2 = value;
            break;
          case 3:
            object.internalValue3 = value;
            break;
          case 4:
            object.internalValue4 = value;
            break;
          case 5:
            object.internalValue5 = value;
            break;
          case 6:
            object.internalValue6 = value;
            break;
          case 7:
            object.internalValue7 = value;
            break;
          default:
            setFastValue<ScriptPropertyKey, unknown>(object, index, value);
            break;
        }
      }
      object.internalShape = targetShape;
      object.internalPropertyEpoch = count;
      return object;
    }
    const object = remember(
      createMarkedOrdinaryObject(
        objectPrototype,
        objectPrototype.internalRareSlots?.internalChildShape,
        0,
      ),
    );
    let omitted = false;
    for (let index = 0; index < count; index++) {
      if (position < end && bytes[position] === tagOmitted) {
        position++;
        omitted = true;
        continue;
      }
      const name = shapeKeys[index];
      if (name === undefined) return invalid();
      define(object, name, decode());
    }
    const reached = object.internalShape;
    if (
      !omitted &&
      (object.internalFlags & objectFlagDictionary) === 0 &&
      reached !== undefined &&
      reached.shared &&
      reached.keys.length === count
    ) {
      site.root = objectPrototype.internalRareSlots?.internalChildShape;
      site.shape = reached;
    }
    return object;
  }
  function finishOmittedShapeObject(
    object: ScriptObject,
    shapeKeys: readonly ScriptPropertyKey[],
    omittedIndex: number,
    count: number,
  ): ScriptObject {
    const filled: unknown[] = [];
    for (let prev = 0; prev < omittedIndex; prev++)
      filled.push(storedValue<ScriptPropertyKey, unknown>(object, prev));
    object.internalValue0 = undefined;
    object.internalValue1 = undefined;
    object.internalValue2 = undefined;
    object.internalValue3 = undefined;
    object.internalValue4 = undefined;
    object.internalValue5 = undefined;
    object.internalValue6 = undefined;
    object.internalValue7 = undefined;
    object.internalValues = undefined;
    for (let prev = 0; prev < omittedIndex; prev++) {
      const name = shapeKeys[prev];
      if (name === undefined) return invalid();
      define(object, name, filled[prev]);
    }
    for (let rest = omittedIndex + 1; rest < count; rest++) {
      if (position < end && bytes[position] === tagOmitted) {
        position++;
        continue;
      }
      const name = shapeKeys[rest];
      if (name === undefined) return invalid();
      define(object, name, decode());
    }
    return object;
  }
  function decode(): unknown {
    const kind = next();
    if (kind === tagShapeObject) {
      const site = shapes[varint()];
      return site === undefined ? invalid() : decodeShapeObject(site);
    }
    if (kind === tagRecentString) {
      const slot = next();
      if (slot >= recentStringSlots) return invalid();
      const cached = recentStrings[slot];
      return cached === undefined ? invalid() : cached;
    }
    if (kind === tagOneByteString) {
      const units = varint();
      if (units > end - position) return invalid();
      const startAt = position;
      const value = latin1Text(bytes, startAt, startAt + units);
      position = startAt + units;
      if (units >= 1 && units <= recentStringMaxUnits) {
        const slot =
          ((units << 3) ^
            ((bytes[startAt] ?? 0) << 1) ^
            (bytes[startAt + units - 1] ?? 0)) &
          31;
        recentStrings[slot] = value;
      }
      return value;
    }
    if (kind === tagInt32) {
      const zigzag = varint();
      if (zigzag > 4294967295) return invalid();
      return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
    }
    if (kind === tagDouble) return float();
    if (kind === tagTrue) return true;
    if (kind === tagFalse) return false;
    if (kind === tagDenseArray || kind === tagNumberArray) {
      const length = varint(),
        count = varint();
      if (count > length || length > 4294967295) return invalid();
      const elements: ArrayElements<ScriptPropertyKey, unknown> = {
        keys: arrayHooks,
        undefinedValue: hooks.undefinedValue,
        numberCount: 0,
        numbers: noNumbers,
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length,
        lengthWritable: true,
      };
      const object = remember(
        createMarkedPackedArrayObject(
          arrayPrototype,
          arrayChildShape,
          elements,
          arrayMethods,
        ),
      );
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
      } else if (count > 0) {
        // Elements append directly to packed general storage until the first
        // hole; later ones are ordinary index properties.
        const capacity = count < firstCapacity ? firstCapacity : count;
        elements.generalTags = new Uint8Array(capacity);
        elements.generalRefs = allocGeneralRefs(capacity);
        let packed = true;
        for (let index = 0; index < count; index++) {
          if (position < end && bytes[position] === tagHole) {
            position++;
            packed = false;
            continue;
          }
          const value = decode();
          if (
            packed &&
            object.internalArrayElements === elements &&
            elements.generalCount === index
          ) {
            if (
              !writeGeneralSlot(
                elements.generalTags,
                elements.generalRefs,
                elements.numbers,
                index,
                value,
              )
            ) {
              ensureGeneralNumbers<ScriptPropertyKey, unknown>(elements);
              writeGeneralSlot(
                elements.generalTags,
                elements.generalRefs,
                elements.numbers,
                index,
                value,
              );
            }
            elements.generalCount = index + 1;
          } else define(object, arrayHooks.indexKey(index), value);
        }
      }
      if (position < end && bytes[position] === endDenseArray) {
        position++;
        return object;
      }
      return properties(object, endDenseArray);
    }
    if (kind === tagUndefined) return undefined;
    if (kind === tagNull) return null;
    if (kind === tagNewShape) {
      const count = varint();
      if (count === 0) return invalid();
      const shapeKeys: ScriptPropertyKey[] = [];
      for (let index = 0; index < count; index++) shapeKeys.push(key());
      const site = createObjectLiteralSite(shapeKeys);
      shapes.push(site);
      return decodeShapeObject(site);
    }
    if (kind === tagString) return string();
    if (kind === tagSharedString) {
      const value = attachments?.decodeString?.(varint());
      return value === undefined ? invalid() : value;
    }
    if (kind === tagObject)
      return properties(
        remember(
          createMarkedOrdinaryObject(
            objectPrototype,
            objectPrototype.internalRareSlots?.internalChildShape,
            0,
          ),
        ),
        endObject,
      );
    if (kind === tagReference) {
      const value = objects[varint()];
      return value === undefined ? invalid() : value;
    }
    if (kind === tagBigInt) {
      const value = bigIntFromString(string());
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
    return invalid();
  }
  if (usePool) {
    activeFastDecode = true;
    try {
      const result = decode();
      return position === end ? result : invalid();
    } finally {
      objects.length = 0;
      keys.length = 0;
      shapes.length = 0;
      clearRecentStrings(recentStrings);
      activeFastDecode = false;
    }
  }
  const result = decode();
  return position === end ? result : invalid();
}

/** Clone inside one realm using the same graph traversal as worker messages.
 * Transfer sources remain live until traversal and decoding both succeed. */
export function installStructuredClone(
  global: ScriptObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const clone = builtinFunction(
    realm.functionPrototype,
    "structuredClone",
    1,
    (_receiver, args): unknown => {
      if (args.length === 0) throw createRuntimeError(realm, "type");
      const transfers: ByteStorage[] = [];
      const options = args[1];
      if (options !== undefined && options !== null) {
        const object = viewObjectValue(options, global);
        if (object === undefined) throw createRuntimeError(realm, "type");
        const transfer = getProperty<ScriptPropertyKey, unknown>(
          object,
          "transfer",
          object,
          hooks,
        );
        if (transfer !== undefined) {
          const list = viewObjectValue(transfer, global);
          if (
            list === undefined ||
            (list.internalFlags & objectFlagArrayData) === 0
          )
            throw createRuntimeError(realm, "type");
          for (const value of arrayLikeValues(list, realm, hooks)) {
            const item = viewObjectValue(value, global);
            const storage =
              item === undefined
                ? undefined
                : exoticSlots(item).internalArrayBufferData;
            if (
              storage === undefined ||
              storage.immutable ||
              storage.data === undefined
            )
              return throwWorkerCloneError(
                realm,
                "The object cannot be transferred",
              );
            if (transfers.includes(storage))
              return throwWorkerCloneError(
                realm,
                "Duplicate object in transfer list",
              );
            transfers.push(storage);
          }
        }
      }
      const float = new Float64Array(1);
      const floatBytes = new Uint8Array(float.buffer);
      const sink: WorkerCloneSink = {
        bytes: new Uint8Array(128),
        grow: (used, needed): void => {
          const bytes = new Uint8Array(
            Math.max(used + needed, sink.bytes.length * 2),
          );
          bytes.set(sink.bytes.subarray(0, used));
          sink.bytes = bytes;
        },
        writeFloat64: (offset, value): void => {
          float[0] = value;
          sink.bytes.set(floatBytes, offset);
        },
        writeString: (offset, value): void => {
          for (let i = 0; i < value.length; i++) {
            const unit = value.charCodeAt(i);
            sink.bytes[offset + i * 2] = unit & 255;
            sink.bytes[offset + i * 2 + 1] = unit >>> 8;
          }
        },
      };
      const shared: ScriptObject[] = [];
      const attachments: WorkerCloneAttachments = {
        encode: (object): number | undefined => {
          const storage = exoticSlots(object).internalSharedArrayBufferData;
          if (storage === undefined) return undefined;
          const buffer = createObject<ScriptPropertyKey, unknown>(
            realm.sharedArrayBufferPrototype,
          );
          ensureExoticSlots(buffer).internalSharedArrayBufferData = storage;
          shared.push(buffer);
          return shared.length - 1;
        },
        decode: (index): ScriptObject | undefined => shared[index],
      };
      const end = serializeWorkerValue(args[0], realm, sink, 0, attachments);
      const source: WorkerCloneSource = {
        bytes: sink.bytes,
        readFloat64: (offset): number => {
          floatBytes.set(sink.bytes.subarray(offset, offset + 8));
          return float[0] ?? 0;
        },
        readString: (offset, units): string => {
          let value = "";
          for (let i = 0; i < units; i++)
            value += String.fromCharCode(
              (sink.bytes[offset + i * 2] ?? 0) +
                256 * (sink.bytes[offset + i * 2 + 1] ?? 0),
            );
          return value;
        },
      };
      const result = deserializeWorkerValue(source, 0, end, realm, attachments);
      for (const storage of transfers)
        if (storage.data === undefined)
          return throwWorkerCloneError(
            realm,
            "The ArrayBuffer was detached during cloning",
          );
      for (const storage of transfers) detachByteStorage(storage);
      return result;
    },
    hooks,
  );
  builtinProperty(global, "structuredClone", clone, true, true, hooks);
}
