import {
  appendString,
  createStringBuilder,
  finishString,
} from "@tint/foundation/text/string-builder";
import { setMap } from "@tint/foundation/collections/linked-map";
import { createByteStorage, byteStorageData } from "../bytes/index.ts";
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
  decode?(index: number): ScriptObject | undefined;
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
  return (
    object.internalCall !== undefined ||
    object.internalConstruct !== undefined ||
    object.internalPromiseData !== undefined ||
    exoticSlots(object).internalProxyData !== undefined ||
    exoticSlots(object).internalWeakData !== undefined ||
    object.internalGeneratorData !== undefined ||
    object.internalAsyncGeneratorData !== undefined ||
    exoticSlots(object).internalSyncIteratorData !== undefined ||
    exoticSlots(object).internalIteratorHelperData !== undefined ||
    exoticSlots(object).internalWrappedIteratorData !== undefined ||
    exoticSlots(object).internalMapIteratorData !== undefined ||
    exoticSlots(object).internalSetIteratorData !== undefined ||
    exoticSlots(object).internalRegExpIteratorData !== undefined ||
    object.internalArrayIteratorData !== undefined ||
    exoticSlots(object).internalStringIteratorData !== undefined ||
    exoticSlots(object).internalSharedArrayBufferData !== undefined ||
    exoticSlots(object).internalDisposableStack !== undefined ||
    exoticSlots(object).internalAsyncDisposableStack !== undefined ||
    exoticSlots(object).internalTemporalPlainYearMonth !== undefined ||
    exoticSlots(object).internalTemporalPlainMonthDay !== undefined ||
    exoticSlots(object).internalTemporalPlainDate !== undefined ||
    exoticSlots(object).internalTemporalDuration !== undefined ||
    exoticSlots(object).internalTemporalPlainTime !== undefined ||
    exoticSlots(object).internalTemporalPlainDateTime !== undefined ||
    exoticSlots(object).internalTemporalZonedDateTime !== undefined ||
    exoticSlots(object).internalTemporalCalendar !== undefined ||
    exoticSlots(object).internalTemporalInstant !== undefined ||
    exoticSlots(object).internalLocaleData !== undefined ||
    exoticSlots(object).internalListFormatData !== undefined ||
    exoticSlots(object).internalSegmenterData !== undefined ||
    exoticSlots(object).internalCollatorData !== undefined ||
    exoticSlots(object).internalPluralRulesData !== undefined ||
    exoticSlots(object).internalIntlFormatData !== undefined ||
    exoticSlots(object).internalRelativeTimeData !== undefined ||
    exoticSlots(object).internalNumberFormatData !== undefined ||
    object.internalArgumentsData ||
    exoticSlots(object).internalShadowRealm !== undefined
  );
}

function arrayKind(name: string): TypedArrayElementKind | undefined {
  switch (name) {
    case "Int8":
    case "Uint8":
    case "Uint8Clamped":
    case "Int16":
    case "Uint16":
    case "Int32":
    case "Uint32":
    case "Float16":
    case "Float32":
    case "Float64":
    case "BigInt64":
    case "BigUint64":
      return name;
    default:
      return undefined;
  }
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

/** Snapshot a graph into a UTF-16 sequence, preserving lone surrogates and
 * references to every first-seen object. Only enumerable own string keys
 * participate in ordinary object and array cloning. */
export function serializeWorkerValue(
  value: unknown,
  realm: ErrorRealm,
  attachments?: WorkerCloneAttachments,
): string {
  const packet = createStringBuilder();
  const objects = new Map<number, number>();
  const hooks = realm.objectHooks;
  function tag(value: string): void {
    appendString(packet, value);
  }
  function field(value: string): void {
    tag(String(value.length) + ":");
    tag(value);
  }
  function number(value: number): void {
    field(value === 0 && 1 / value === -Infinity ? "-0" : String(value));
  }
  function encode(value: unknown): void {
    if (value === undefined) return tag("u");
    if (value === null) return tag("n");
    if (typeof value === "boolean") return tag(value ? "t" : "f");
    if (typeof value === "number") {
      tag("d");
      return number(value);
    }
    if (typeof value === "string") {
      tag("s");
      return field(value);
    }
    const big = viewBigIntValue(value);
    if (big !== undefined) {
      const digits = bigIntToString(big, 10);
      if (digits === undefined) throw "WORKER_CLONE_BIGINT_RADIX";
      tag("i");
      return field(digits);
    }
    const object = viewObjectValue(value, realm.objectPrototype);
    if (object === undefined)
      return throwWorkerCloneError(realm, "The value could not be cloned");
    if (object.internalIdentity === 0)
      object.internalIdentity = realm.agent.nextObjectIdentity++;
    const seen = objects.get(object.internalIdentity);
    if (seen !== undefined) {
      tag("r");
      return number(seen);
    }
    objects.set(object.internalIdentity, objects.size);
    const grant = attachments?.encode?.(object);
    if (grant !== undefined) {
      tag("x");
      return number(grant);
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
      tag("w");
      return encode(primitive.value);
    }
    const typed = exoticSlots(object).internalTypedArrayData;
    if (typed !== undefined) {
      if (typedArrayWindow(typed) === undefined)
        return throwWorkerCloneError(realm, "The typed array is out of bounds");
      tag("T");
      field(typed.kind);
      tag(typed.endian === "little" ? "l" : "b");
      number(typed.byteOffset);
      number(typed.length ?? -1);
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
      tag("V");
      number(view.byteOffset);
      number(view.byteLength ?? -1);
      return encode(view.buffer);
    }
    if (exoticSlots(object).internalErrorData) {
      tag("E");
      const name = getProperty<ScriptPropertyKey, unknown>(
        object,
        "name",
        object,
        hooks,
      );
      field(typeof name === "string" ? name : "Error");
      const message = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        "message",
      );
      const hasMessage = message !== undefined && !message.accessor;
      tag(hasMessage ? "1" : "0");
      if (message !== undefined && !message.accessor) {
        const value = stringValue(message.value, hooks, realm);
        if (value.error !== "none") throw createRuntimeError(realm, "type");
        field(value.value);
      }
      const stack = exoticSlots(object).internalErrorStack;
      tag(stack === undefined ? "0" : "1");
      if (stack !== undefined) field(stack);
      const cause = getOwnProperty<ScriptPropertyKey, unknown>(object, "cause");
      const hasCause = cause !== undefined && !cause.accessor;
      tag(hasCause ? "1" : "0");
      if (cause !== undefined && !cause.accessor) encode(cause.value);
      return;
    }
    const map = exoticSlots(object).internalMapData;
    const set = exoticSlots(object).internalSetData;
    if (map !== undefined || set !== undefined) {
      let head = map === undefined ? set?.head : map.head;
      const keys: unknown[] = [];
      const values: unknown[] = [];
      while (head !== undefined) {
        keys.push(head.key);
        if (map !== undefined) values.push(head.value);
        head = head.next;
      }
      tag(map === undefined ? "q" : "m");
      number(keys.length);
      for (let index = 0; index < keys.length; index++) {
        encode(keys[index]);
        if (map !== undefined) encode(values[index]);
      }
      return;
    }
    const date = exoticSlots(object).internalDateValue;
    if (date !== undefined) {
      tag("D");
      return number(date);
    }
    const expression = exoticSlots(object).internalRegExpData;
    if (expression !== undefined) {
      tag("R");
      field(expression.originalSource);
      return field(expression.originalFlags);
    }
    const storage = exoticSlots(object).internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = byteStorageData(storage);
      if (bytes === undefined)
        return throwWorkerCloneError(realm, "The ArrayBuffer is detached");
      tag(storage.resizable ? "A" : "B");
      number(storage.maxByteLength);
      number(bytes.length);
      for (let index = 0; index < bytes.length; index++)
        tag(String.fromCharCode(bytes[index] ?? 0));
      return;
    }
    if (object.internalArrayData) {
      tag("a");
      const length = getOwnProperty<ScriptPropertyKey, unknown>(
        object,
        "length",
      )?.value;
      if (typeof length !== "number") throw "WORKER_CLONE_ARRAY_LENGTH";
      number(length);
    } else tag("o");
    const keys = ownKeys<ScriptPropertyKey, unknown>(
      object,
      scriptPropertyKeyOrder,
    );
    for (const key of keys) {
      if (typeof key !== "string") continue;
      const property = getOwnProperty<ScriptPropertyKey, unknown>(object, key);
      if (property === undefined || !property.enumerable) continue;
      tag("k");
      field(key);
      encode(
        getProperty<ScriptPropertyKey, unknown>(object, key, object, hooks),
      );
    }
    tag(".");
  }
  encode(value);
  return finishString(packet);
}

export function deserializeWorkerValue(
  packet: string,
  realm: ErrorRealm,
  attachments?: WorkerCloneAttachments,
): unknown {
  const objects: (ScriptObject | undefined)[] = [];
  const hooks = realm.objectHooks;
  let next = 0;
  function invalid(): never {
    return throwWorkerCloneError(realm, "Invalid worker clone payload");
  }
  function tag(): string {
    if (next >= packet.length) return invalid();
    return packet.charAt(next++);
  }
  function field(): string {
    const boundary = packet.indexOf(":", next);
    if (boundary < next) return invalid();
    const lengthText = packet.slice(next, boundary);
    const length = Number(lengthText);
    next = boundary + 1;
    if (
      length < 0 ||
      !Number.isSafeInteger(length) ||
      String(length) !== lengthText ||
      length > packet.length - next
    )
      return invalid();
    const value = packet.slice(next, next + length);
    next += length;
    return value;
  }
  function count(): number {
    const value = Number(field());
    if (!Number.isSafeInteger(value) || value < 0) return invalid();
    return value;
  }
  function present(): boolean {
    const flag = tag();
    if (flag !== "0" && flag !== "1") return invalid();
    return flag === "1";
  }
  function remember(object: ScriptObject): ScriptObject {
    objects.push(object);
    return object;
  }
  function decode(): unknown {
    const kind = tag();
    if (kind === "u") return undefined;
    if (kind === "n") return null;
    if (kind === "t" || kind === "f") return kind === "t";
    if (kind === "d") return Number(field());
    if (kind === "s") return field();
    if (kind === "i") {
      const value = bigIntFromString(field());
      return value === undefined ? invalid() : value;
    }
    if (kind === "r" || kind === "x") {
      const index = count();
      const value =
        kind === "x" ? attachments?.decode?.(index) : objects[index];
      return value === undefined
        ? invalid()
        : kind === "x"
          ? remember(value)
          : value;
    }
    if (kind === "D") {
      const date = createObject<ScriptPropertyKey, unknown>(
        realm.datePrototype,
      );
      ensureExoticSlots(date).internalDateValue = Number(field());
      return remember(date);
    }
    if (kind === "w") {
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
    if (kind === "R")
      return remember(createRegExpLiteral(field(), field(), realm, hooks));
    if (kind === "E") {
      const error = remember(createRuntimeError(realm, errorKind(field())));
      if (present())
        builtinProperty(error, "message", field(), true, false, hooks);
      ensureExoticSlots(error).internalErrorStack = present()
        ? field()
        : undefined;
      if (present())
        builtinProperty(error, "cause", decode(), true, false, hooks);
      return error;
    }
    if (kind === "T" || kind === "V") {
      const index = objects.length;
      objects.push(undefined);
      const element = kind === "T" ? arrayKind(field()) : undefined;
      const order = kind === "T" ? tag() : "l";
      if (
        (kind === "T" && element === undefined) ||
        (order !== "l" && order !== "b")
      )
        return invalid();
      const byteOffset = count();
      const size = Number(field());
      if (!Number.isSafeInteger(size) || size < -1) return invalid();
      const length = size === -1 ? undefined : size;
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
          endian: order === "l" ? "little" : "big",
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
    if (kind === "A" || kind === "B") {
      const maximum = count(),
        length = count();
      if (length > packet.length - next) return invalid();
      const storage = createByteStorage(
        length,
        maximum,
        kind === "A",
        realm.bufferMaxBytes,
        realm.bufferAllocator,
      );
      if (!storage.ok) return invalid();
      const bytes = byteStorageData(storage.value);
      if (bytes === undefined) return invalid();
      for (let index = 0; index < length; index++) {
        const byte = packet.charCodeAt(next++);
        if (byte > 255) return invalid();
        bytes[index] = byte;
      }
      const buffer = createObject<ScriptPropertyKey, unknown>(
        realm.arrayBufferPrototype,
      );
      ensureExoticSlots(buffer).internalArrayBufferData = storage.value;
      return remember(buffer);
    }
    if (kind === "q" || kind === "m") {
      const isMap = kind === "m";
      const object = remember(
        createObject<ScriptPropertyKey, unknown>(
          isMap ? realm.mapPrototype : realm.setPrototype,
        ),
      );
      const data = createSetData();
      if (isMap) ensureExoticSlots(object).internalMapData = data;
      else ensureExoticSlots(object).internalSetData = data;
      const length = count();
      for (let index = 0; index < length; index++) {
        const key = decode();
        setMap<unknown, unknown>(data, key, isMap ? decode() : key);
      }
      return object;
    }
    if (kind !== "a" && kind !== "o") return invalid();
    const object = remember(
      kind === "a"
        ? createArrayObject<ScriptPropertyKey, unknown>(
            count(),
            realm.arrayPrototype,
            realm.arrayHooks,
            hooks,
          )
        : createObject<ScriptPropertyKey, unknown>(realm.objectPrototype),
    );
    for (;;) {
      const property = tag();
      if (property === ".") return object;
      if (property !== "k") return invalid();
      const key = field();
      const value = decode();
      if (
        !createDataProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          value,
          hooks,
        )
      )
        return invalid();
    }
  }
  const result = decode();
  return next === packet.length ? result : invalid();
}
