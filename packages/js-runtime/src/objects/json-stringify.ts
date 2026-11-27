import {
  pushJSONPropertyKey,
  pushQuotedJSONString,
  quoteJSONString,
} from "./json-string.ts";
import { latin1Text } from "@tint/foundation/text/latin1";
import {
  viewObjectValue,
  getObjectValueProperty,
  callObjectValue,
  isArrayValue,
} from "./values.ts";
import { viewBigIntValue } from "./bigints.ts";
import { isCallableObject } from "./call.ts";
import { numberValue, stringValue } from "./coercion.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { arrayElementCount, readArrayElement } from "./array-elements.ts";
import { canonicalNumericIndex } from "./integer-index.ts";
import {
  exoticSlots,
  createObject,
  createDataProperty,
  ownKeys,
  getOwnProperty,
  shapeKeyIndex,
  storedValue,
  propertyEpoch,
  propertyEnumerable,
  propertyAccessor,
  objectFlagDictionary,
  type OrdinaryObject,
  type OrdinaryPropertyShape,
  type ObjectHooks,
} from "./operations.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type ScriptShape = OrdinaryPropertyShape<ScriptPropertyKey, unknown>;

const jsonBufCapacity = 4096;
let jsonBufScratch: Uint8Array | undefined = undefined;
let jsonBufInUse = false;
const jsonHexBytes = [
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102,
];

function getJsonBufScratch(): Uint8Array {
  const existing = jsonBufScratch;
  if (existing !== undefined) return existing;
  const created = new Uint8Array(jsonBufCapacity);
  jsonBufScratch = created;
  return created;
}

function isCallable(value: unknown, realm: ErrorRealm): boolean {
  return isCallableObject<ScriptPropertyKey, unknown>(
    viewObjectValue(value, realm.objectPrototype),
  );
}

function getPropertyChecked(
  value: unknown,
  key: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const result = getObjectValueProperty(value, key, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

function callChecked(
  method: unknown,
  receiver: unknown,
  args: readonly unknown[],
  realm: ErrorRealm,
): unknown {
  const result = callObjectValue(method, receiver, args, realm.objectPrototype);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

function toStringChecked(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const result = stringValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

function toNumberChecked(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const result = numberValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}

let cachedToJSONRealm: ErrorRealm | undefined = undefined;
let cachedToJSONEpoch = -1;
let cachedObjectProtoClean = false;
let cachedArrayProtoClean = false;

function prototypeChainHasToJSON(start: ScriptObject | undefined): boolean {
  let cursor = start;
  while (cursor !== undefined) {
    if (
      getOwnProperty<ScriptPropertyKey, unknown>(cursor, "toJSON") !== undefined
    )
      return true;
    cursor = cursor.prototype;
  }
  return false;
}

function shapeHasToJSON(shape: ScriptShape): boolean {
  const keys = shape.keys;
  if (keys.length <= 8) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === "toJSON") return true;
    }
    return false;
  }
  const existing = shape.index;
  if (existing !== undefined) return existing.has("toJSON");
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === "toJSON") return true;
  }
  return false;
}

function objectSkipsToJSON(
  object: ScriptObject,
  realm: ErrorRealm,
  objectProtoClean: boolean,
  arrayProtoClean: boolean,
  initialEpoch: number,
): boolean {
  if (propertyEpoch.value !== initialEpoch) return false;
  const rare = object.internalRareSlots;
  if (rare !== undefined && rare.internalDataAliases !== undefined)
    return false;
  if (
    object.internalArrayElements !== undefined ||
    rare?.internalContractedElements !== undefined
  ) {
    if (!arrayProtoClean || object.prototype !== realm.arrayPrototype)
      return false;
    const props = rare?.properties;
    return props === undefined || !props.has("toJSON");
  }
  const methods = object.internalMethods;
  if (methods !== undefined) {
    if (methods.recordViewNoToJSON === true) {
      if (!objectProtoClean || object.prototype !== realm.objectPrototype)
        return false;
      const shape = object.internalShape;
      if (shape !== undefined && shapeHasToJSON(shape)) return false;
      const props = rare?.properties;
      return props === undefined || !props.has("toJSON");
    }
    if (methods.nativeListAccess !== undefined) {
      if (!arrayProtoClean || object.prototype !== realm.arrayPrototype)
        return false;
      const shape = object.internalShape;
      if (shape !== undefined && shapeHasToJSON(shape)) return false;
      const props = rare?.properties;
      return props === undefined || !props.has("toJSON");
    }
    return false;
  }
  if (!objectProtoClean || object.prototype !== realm.objectPrototype)
    return false;
  if ((object.internalFlags & objectFlagDictionary) === 0) {
    const shape = object.internalShape;
    return shape === undefined || !shapeHasToJSON(shape);
  }
  const props = object.internalRareSlots?.properties;
  return props === undefined || !props.has("toJSON");
}

const smallIndexKeys: readonly string[] = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
];

function indexKey(index: number): string {
  return index < 32 ? (smallIndexKeys[index] ?? String(index)) : String(index);
}

function isSimplePrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  );
}

/** Observable JSON serialization uses the ordinary property/call protocols. */
export function stringifyJSON(
  value: unknown,
  replacer: unknown,
  space: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  if ((replacer === undefined || replacer === null) && space === undefined) {
    if (typeof value === "string") return quoteJSONString(value);
    if (typeof value === "number")
      return Number.isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null) return "null";
    if (value === undefined) return undefined;
  }
  const hasReplacer = isCallable(replacer, realm);
  let propertyList: string[] | undefined = undefined;
  if (!hasReplacer && isArrayValue(replacer, realm)) {
    const list: string[] = [];
    const array = viewObjectValue(replacer, realm.objectPrototype);
    if (array === undefined) throw "JSON_REPLACER_INVARIANT";
    const rawPacked =
      array.internalArrayElements ??
      array.internalRareSlots?.internalContractedElements;
    const packedReplacer =
      rawPacked !== undefined &&
      array.prototype === realm.arrayPrototype &&
      arrayElementCount<ScriptPropertyKey, unknown>(rawPacked) ===
        rawPacked.length
        ? rawPacked
        : undefined;
    const nativeListReplacer =
      packedReplacer === undefined && array.prototype === realm.arrayPrototype
        ? array.internalMethods?.nativeListAccess
        : undefined;
    const length =
      packedReplacer !== undefined
        ? packedReplacer.length
        : nativeListReplacer !== undefined
          ? nativeListReplacer.length()
          : lengthOfArrayLike(array, realm, hooks);
    for (let i = 0; i < length; i++) {
      const item =
        packedReplacer !== undefined
          ? readArrayElement<ScriptPropertyKey, unknown>(packedReplacer, i)
          : nativeListReplacer !== undefined
            ? nativeListReplacer.has(i)
              ? nativeListReplacer.read(i)
              : getPropertyChecked(replacer, indexKey(i), realm, hooks)
            : getPropertyChecked(replacer, indexKey(i), realm, hooks);
      if (typeof item === "string") {
        if (!list.includes(item)) list.push(item);
        continue;
      }
      if (typeof item === "number") {
        const key = String(item);
        if (!list.includes(key)) list.push(key);
        continue;
      }
      const object = viewObjectValue(item, realm.objectPrototype);
      const data =
        object === undefined
          ? undefined
          : exoticSlots(object).internalPrimitiveData;
      if (
        data === undefined ||
        (data.kind !== "string" && data.kind !== "number")
      )
        continue;
      const key = toStringChecked(item, realm, hooks);
      if (!list.includes(key)) list.push(key);
    }
    propertyList = list;
  }
  let spacing = space;
  const spaceObject = viewObjectValue(spacing, realm.objectPrototype);
  const spaceData =
    spaceObject === undefined
      ? undefined
      : exoticSlots(spaceObject).internalPrimitiveData;
  if (spaceData !== undefined) {
    if (spaceData.kind === "number")
      spacing = toNumberChecked(spacing, realm, hooks);
    else if (spaceData.kind === "string")
      spacing = toStringChecked(spacing, realm, hooks);
  }
  let gap = "";
  if (typeof spacing === "number") {
    if (spacing > 0) gap = " ".repeat(Math.min(Math.trunc(spacing), 10));
  } else if (typeof spacing === "string") gap = spacing.slice(0, 10);

  const initialEpoch = propertyEpoch.value;
  if (cachedToJSONRealm !== realm || cachedToJSONEpoch !== initialEpoch) {
    const objClean = !prototypeChainHasToJSON(realm.objectPrototype);
    cachedObjectProtoClean = objClean;
    cachedArrayProtoClean =
      objClean && !prototypeChainHasToJSON(realm.arrayPrototype);
    cachedToJSONRealm = realm;
    cachedToJSONEpoch = initialEpoch;
  }
  const objectProtoClean = cachedObjectProtoClean;
  const arrayProtoClean = cachedArrayProtoClean;

  const out: string[] = [];
  const stack: ScriptObject[] = [];
  const ownsScratch = !jsonBufInUse;
  if (ownsScratch) jsonBufInUse = true;
  const buf: Uint8Array = ownsScratch ? getJsonBufScratch() : new Uint8Array(0);
  let bufLen = 0;
  let useBuf = ownsScratch;

  function flushBuf(): void {
    if (!useBuf) return;
    useBuf = false;
    if (bufLen > 0 && buf !== undefined) {
      out.push(latin1Text(buf, 0, bufLen));
      bufLen = 0;
    }
  }

  function emitByte(byte: number): void {
    if (useBuf && buf !== undefined) {
      if (bufLen < jsonBufCapacity) {
        buf[bufLen++] = byte;
        return;
      }
      flushBuf();
    }
    out.push(String.fromCharCode(byte));
  }

  function emitAscii(text: string): void {
    const len = text.length;
    if (useBuf && buf !== undefined) {
      if (bufLen + len <= jsonBufCapacity) {
        let p = bufLen;
        for (let i = 0; i < len; i++) buf[p++] = text.charCodeAt(i);
        bufLen = p;
        return;
      }
      flushBuf();
    }
    out.push(text);
  }

  function emitText(text: string): void {
    const len = text.length;
    if (useBuf && buf !== undefined && bufLen + len <= jsonBufCapacity) {
      let p = bufLen;
      let ok = true;
      for (let i = 0; i < len; i++) {
        const c = text.charCodeAt(i);
        if (c > 0xff) {
          ok = false;
          break;
        }
        buf[p++] = c;
      }
      if (ok) {
        bufLen = p;
        return;
      }
      flushBuf();
    } else if (useBuf) {
      flushBuf();
    }
    out.push(text);
  }

  function emitQuoted(text: string): void {
    const len = text.length;
    if (
      useBuf &&
      buf !== undefined &&
      bufLen + len * 6 + 2 <= jsonBufCapacity
    ) {
      const startPos = bufLen;
      let p = startPos;
      buf[p++] = 34;
      let ok = true;
      for (let i = 0; i < len; i++) {
        const u = text.charCodeAt(i);
        if (u > 0xff) {
          ok = false;
          break;
        }
        if (u >= 32 && u !== 34 && u !== 92) {
          buf[p++] = u;
        } else if (u === 34) {
          buf[p++] = 92;
          buf[p++] = 34;
        } else if (u === 92) {
          buf[p++] = 92;
          buf[p++] = 92;
        } else if (u === 8) {
          buf[p++] = 92;
          buf[p++] = 98;
        } else if (u === 9) {
          buf[p++] = 92;
          buf[p++] = 116;
        } else if (u === 10) {
          buf[p++] = 92;
          buf[p++] = 110;
        } else if (u === 12) {
          buf[p++] = 92;
          buf[p++] = 102;
        } else if (u === 13) {
          buf[p++] = 92;
          buf[p++] = 114;
        } else {
          buf[p++] = 92;
          buf[p++] = 117;
          buf[p++] = 48;
          buf[p++] = 48;
          buf[p++] = jsonHexBytes[(u >>> 4) & 15] ?? 48;
          buf[p++] = jsonHexBytes[u & 15] ?? 48;
        }
      }
      if (ok) {
        buf[p++] = 34;
        bufLen = p;
        return;
      }
      bufLen = startPos;
      flushBuf();
    } else if (useBuf) {
      flushBuf();
    }
    pushQuotedJSONString(out, text);
  }

  function emitNumber(n: number): void {
    const intVal = n | 0;
    if (
      intVal === n &&
      useBuf &&
      buf !== undefined &&
      bufLen + 12 <= jsonBufCapacity
    ) {
      if (intVal === 0) {
        buf[bufLen++] = 48;
        return;
      }
      if (intVal > 0 && intVal < 1000000000) {
        let p = bufLen;
        if (intVal < 10) {
          buf[p++] = 48 + intVal;
        } else if (intVal < 100) {
          const tens = (intVal / 10) | 0;
          buf[p++] = 48 + tens;
          buf[p++] = 48 + (intVal - tens * 10);
        } else if (intVal < 1000) {
          const h = (intVal / 100) | 0;
          const r = intVal - h * 100;
          const t = (r / 10) | 0;
          buf[p++] = 48 + h;
          buf[p++] = 48 + t;
          buf[p++] = 48 + (r - t * 10);
        } else if (intVal < 10000) {
          const th = (intVal / 1000) | 0;
          const r1 = intVal - th * 1000;
          const h = (r1 / 100) | 0;
          const r2 = r1 - h * 100;
          const t = (r2 / 10) | 0;
          buf[p++] = 48 + th;
          buf[p++] = 48 + h;
          buf[p++] = 48 + t;
          buf[p++] = 48 + (r2 - t * 10);
        } else {
          const s = String(intVal);
          for (let i = 0; i < s.length; i++) buf[p++] = s.charCodeAt(i);
        }
        bufLen = p;
        return;
      }
    }
    if (intVal === n && intVal >= 0 && intVal < 256)
      emitAscii(indexKey(intVal));
    else emitAscii(Number.isFinite(n) ? String(n) : "null");
  }

  function emitPropertyKey(
    key: string,
    written: boolean,
    nested: string,
  ): void {
    if (useBuf && buf !== undefined) {
      if (gap === "") {
        if (written) emitByte(44);
        emitQuoted(key);
        emitByte(58);
      } else {
        emitAscii(written ? ",\n" : "\n");
        emitText(nested);
        emitQuoted(key);
        emitAscii(": ");
      }
      return;
    }
    if (gap === "") {
      pushJSONPropertyKey(out, written ? ',"' : '"', key, '":');
    } else {
      pushJSONPropertyKey(
        out,
        (written ? ",\n" : "\n") + nested + '"',
        key,
        '": ',
      );
    }
  }

  function appendPrimitive(current: unknown): boolean {
    if (current === null) {
      emitAscii("null");
      return true;
    }
    if (typeof current === "boolean") {
      emitAscii(current ? "true" : "false");
      return true;
    }
    if (typeof current === "string") {
      emitQuoted(current);
      return true;
    }
    if (typeof current === "number") {
      emitNumber(current);
      return true;
    }
    return false;
  }

  function serializeValue(
    key: string,
    initial: unknown,
    holder: ScriptObject | undefined,
    indent: string,
  ): boolean {
    let current = initial;
    if (!hasReplacer && isSimplePrimitive(current)) {
      if (current === undefined) return false;
      return appendPrimitive(current);
    }
    const initialObject = viewObjectValue(current, realm.objectPrototype);
    if (initialObject !== undefined) {
      if (
        !objectSkipsToJSON(
          initialObject,
          realm,
          objectProtoClean,
          arrayProtoClean,
          initialEpoch,
        )
      ) {
        const method = getPropertyChecked(current, "toJSON", realm, hooks);
        if (isCallable(method, realm))
          current = callChecked(method, current, [key], realm);
      }
    } else if (viewBigIntValue(current) !== undefined) {
      const method = getPropertyChecked(current, "toJSON", realm, hooks);
      if (isCallable(method, realm))
        current = callChecked(method, current, [key], realm);
    }
    if (hasReplacer) {
      if (holder === undefined) throw "JSON_HOLDER_INVARIANT";
      current = callChecked(replacer, holder, [key, current], realm);
    }
    let object = viewObjectValue(current, realm.objectPrototype);
    if (object !== undefined) {
      const exotic = object.internalRareSlots?.internalExoticSlots;
      const data =
        exotic === undefined ? undefined : exotic.internalPrimitiveData;
      if (data !== undefined) {
        if (data.kind === "number")
          current = toNumberChecked(current, realm, hooks);
        else if (data.kind === "string")
          current = toStringChecked(current, realm, hooks);
        else if (data.kind === "boolean" || data.kind === "bigint")
          current = data.value;
        object = viewObjectValue(current, realm.objectPrototype);
      }
    }
    if (current === null) {
      emitAscii("null");
      return true;
    }
    if (typeof current === "boolean") {
      emitAscii(current ? "true" : "false");
      return true;
    }
    if (typeof current === "string") {
      emitQuoted(current);
      return true;
    }
    if (typeof current === "number") {
      emitNumber(current);
      return true;
    }
    if (object === undefined) {
      if (viewBigIntValue(current) !== undefined)
        throw createRuntimeError(realm, "type");
      return false;
    }
    const exotic = object.internalRareSlots?.internalExoticSlots;
    const raw = exotic === undefined ? undefined : exotic.internalRawJSON;
    if (raw !== undefined) {
      emitText(raw);
      return true;
    }
    if (isCallableObject<ScriptPropertyKey, unknown>(object)) return false;
    for (let i = 0; i < stack.length; i++) {
      if (stack[i] === object) throw createRuntimeError(realm, "type");
    }
    stack.push(object);
    try {
      const isArray = isArrayValue(current, realm);
      const nested = gap === "" ? "" : indent + gap;
      if (isArray) {
        serializeArray(object, indent, nested);
      } else {
        serializeObject(object, indent, nested);
      }
      return true;
    } finally {
      stack.pop();
    }
  }

  function serializeArray(
    object: ScriptObject,
    indent: string,
    nested: string,
  ): void {
    const packed =
      object.internalArrayElements ??
      object.internalRareSlots?.internalContractedElements;
    if (
      !hasReplacer &&
      packed !== undefined &&
      object.prototype === realm.arrayPrototype &&
      arrayProtoClean &&
      propertyEpoch.value === initialEpoch &&
      arrayElementCount<ScriptPropertyKey, unknown>(packed) === packed.length
    ) {
      const length = packed.length;
      if (length === 0) {
        emitAscii("[]");
        return;
      }
      if (gap === "") emitByte(91);
      else {
        emitAscii("[\n");
        emitText(nested);
      }
      if (packed.generalCount === 0) {
        const numbers = packed.numbers;
        for (let i = 0; i < length; i++) {
          if (i > 0) {
            if (gap === "") emitByte(44);
            else {
              emitAscii(",\n");
              emitText(nested);
            }
          }
          const n = numbers[i];
          if (n === undefined) emitAscii("null");
          else emitNumber(n);
        }
      } else {
        for (let i = 0; i < length; i++) {
          if (i > 0) {
            if (gap === "") emitByte(44);
            else {
              emitAscii(",\n");
              emitText(nested);
            }
          }
          const elem = readArrayElement<ScriptPropertyKey, unknown>(packed, i);
          if (isSimplePrimitive(elem)) {
            if (elem === undefined || !appendPrimitive(elem)) emitAscii("null");
          } else {
            if (!serializeValue(indexKey(i), elem, object, nested))
              emitAscii("null");
          }
        }
      }
      if (gap !== "") {
        emitByte(10);
        emitText(indent);
      }
      emitByte(93);
      return;
    }
    const nativeList = object.internalMethods?.nativeListAccess;
    if (
      !hasReplacer &&
      nativeList !== undefined &&
      object.prototype === realm.arrayPrototype &&
      arrayProtoClean &&
      propertyEpoch.value === initialEpoch
    ) {
      const length = nativeList.length();
      if (length === 0) {
        emitAscii("[]");
        return;
      }
      if (gap === "") emitByte(91);
      else {
        emitAscii("[\n");
        emitText(nested);
      }
      for (let i = 0; i < length; i++) {
        if (i > 0) {
          if (gap === "") emitByte(44);
          else {
            emitAscii(",\n");
            emitText(nested);
          }
        }
        const elem = nativeList.has(i)
          ? nativeList.read(i)
          : getPropertyChecked(object, indexKey(i), realm, hooks);
        if (isSimplePrimitive(elem)) {
          if (elem === undefined || !appendPrimitive(elem)) emitAscii("null");
        } else {
          if (!serializeValue(indexKey(i), elem, object, nested))
            emitAscii("null");
        }
      }
      if (gap !== "") {
        emitByte(10);
        emitText(indent);
      }
      emitByte(93);
      return;
    }
    const props = object.internalRareSlots?.properties;
    if (
      !hasReplacer &&
      packed === undefined &&
      props !== undefined &&
      object.prototype === realm.arrayPrototype &&
      arrayProtoClean &&
      propertyEpoch.value === initialEpoch
    ) {
      const lenDesc = props.get("length");
      const rawLength =
        lenDesc !== undefined && !lenDesc.accessor ? lenDesc.value : undefined;
      if (typeof rawLength === "number") {
        const length = rawLength;
        if (length === 0) {
          emitAscii("[]");
          return;
        }
        if (gap === "") emitByte(91);
        else {
          emitAscii("[\n");
          emitText(nested);
        }
        for (let i = 0; i < length; i++) {
          if (i > 0) {
            if (gap === "") emitByte(44);
            else {
              emitAscii(",\n");
              emitText(nested);
            }
          }
          const key = indexKey(i);
          const desc =
            object.internalRareSlots?.properties === props
              ? props.get(key)
              : undefined;
          let elem: unknown;
          if (desc !== undefined && !desc.accessor) elem = desc.value;
          else elem = getPropertyChecked(object, key, realm, hooks);
          if (isSimplePrimitive(elem)) {
            if (elem === undefined || !appendPrimitive(elem)) emitAscii("null");
          } else {
            if (!serializeValue(key, elem, object, nested)) emitAscii("null");
          }
        }
        if (gap !== "") {
          emitByte(10);
          emitText(indent);
        }
        emitByte(93);
        return;
      }
    }
    const length = lengthOfArrayLike(object, realm, hooks);
    if (length === 0) {
      emitAscii("[]");
      return;
    }
    if (gap === "") emitByte(91);
    else {
      emitAscii("[\n");
      emitText(nested);
    }
    for (let i = 0; i < length; i++) {
      if (i > 0) {
        if (gap === "") emitByte(44);
        else {
          emitAscii(",\n");
          emitText(nested);
        }
      }
      const key = indexKey(i);
      const elem = getPropertyChecked(object, key, realm, hooks);
      if (!serializeValue(key, elem, object, nested)) emitAscii("null");
    }
    if (gap !== "") {
      emitByte(10);
      emitText(indent);
    }
    emitByte(93);
  }

  function appendProperty(
    key: string,
    propValue: unknown,
    object: ScriptObject,
    nested: string,
    written: boolean,
  ): boolean {
    if (!hasReplacer && propValue === undefined) return written;
    if (!hasReplacer && isSimplePrimitive(propValue)) {
      emitPropertyKey(key, written, nested);
      appendPrimitive(propValue);
      return true;
    }
    const wasBuf = useBuf;
    const mark = wasBuf ? bufLen : out.length;
    emitPropertyKey(key, written, nested);
    if (!serializeValue(key, propValue, object, nested)) {
      if (useBuf) {
        bufLen = mark;
      } else if (wasBuf) {
        const first = out[0];
        if (first !== undefined && first.length > mark) {
          out[0] = first.slice(0, mark);
          out.length = 1;
        } else if (mark === 0) {
          out.length = 0;
        }
      } else {
        while (out.length > mark) out.pop();
      }
      return written;
    }
    return true;
  }

  function serializeObject(
    object: ScriptObject,
    indent: string,
    nested: string,
  ): void {
    emitByte(123);
    let written = false;
    const rare = object.internalRareSlots;
    const methods = object.internalMethods;
    if (!hasReplacer && methods !== undefined) {
      const access = methods.recordViewAccess;
      if (access !== undefined) {
        const rareProps = rare === undefined ? undefined : rare.properties;
        const noExpandos =
          object.internalShape === undefined &&
          (rareProps === undefined || rareProps.size === 0);
        if (
          propertyList === undefined &&
          methods.recordViewNoIntegerKeys === true &&
          noExpandos
        ) {
          const keys = access.keys;
          for (let f = 0; f < keys.length; f++) {
            const prop = keys[f];
            if (prop === undefined) throw "JSON_KEY_INVARIANT";
            written = appendProperty(
              prop,
              access.read(f),
              object,
              nested,
              written,
            );
          }
          if (written && gap !== "") {
            emitByte(10);
            emitText(indent);
          }
          emitByte(125);
          return;
        }
        const filterList = propertyList;
        if (filterList !== undefined && noExpandos) {
          const keys = access.keys;
          for (let i = 0; i < filterList.length; i++) {
            const property = filterList[i];
            if (property === undefined) throw "JSON_KEY_INVARIANT";
            let field = -1;
            for (let f = 0; f < keys.length; f++) {
              if (keys[f] === property) {
                field = f;
                break;
              }
            }
            const propValue =
              field >= 0
                ? access.read(field)
                : getPropertyChecked(object, property, realm, hooks);
            written = appendProperty(
              property,
              propValue,
              object,
              nested,
              written,
            );
          }
          if (written && gap !== "") {
            emitByte(10);
            emitText(indent);
          }
          emitByte(125);
          return;
        }
      }
    }
    const plain =
      !hasReplacer &&
      propertyList === undefined &&
      methods === undefined &&
      (rare === undefined || rare.internalDataAliases === undefined);

    if (plain && (object.internalFlags & objectFlagDictionary) === 0) {
      const shape = object.internalShape;
      if (shape !== undefined) {
        const keys = shape.keys;
        const kinds = shape.kinds;
        for (let i = 0; i < keys.length; i++) {
          const prop = keys[i];
          if (typeof prop !== "string") continue;
          const kind = kinds[i] ?? 0;
          if ((kind & propertyEnumerable) === 0) continue;
          let propValue: unknown;
          if (
            (kind & propertyAccessor) === 0 &&
            object.internalShape === shape
          ) {
            const raw = storedValue<ScriptPropertyKey, unknown>(object, i);
            propValue = raw === undefined ? shape.undefinedValue : raw;
          } else {
            propValue = getPropertyChecked(object, prop, realm, hooks);
          }
          if (isSimplePrimitive(propValue)) {
            if (propValue === undefined) continue;
            emitPropertyKey(prop, written, nested);
            appendPrimitive(propValue);
            written = true;
          } else {
            written = appendProperty(prop, propValue, object, nested, written);
          }
        }
      }
      if (written && gap !== "") {
        emitByte(10);
        emitText(indent);
      }
      emitByte(125);
      return;
    }

    if (plain && (object.internalFlags & objectFlagDictionary) !== 0) {
      const props = object.internalRareSlots?.properties;
      if (props === undefined || props.size === 0) {
        emitByte(125);
        return;
      }
      let fastDict = true;
      let allPrimitive = true;
      const snapKeys: string[] = [];
      const snapVals: unknown[] = [];
      for (const [k, desc] of props) {
        if (typeof k !== "string") continue;
        const firstCode = k.charCodeAt(0);
        if (
          desc.accessor ||
          (firstCode >= 48 &&
            firstCode <= 57 &&
            canonicalNumericIndex(k) !== undefined)
        ) {
          fastDict = false;
          break;
        }
        if (desc.enumerable) {
          const v = desc.value;
          if (!isSimplePrimitive(v)) allPrimitive = false;
          snapKeys.push(k);
          snapVals.push(v);
        }
      }
      if (fastDict) {
        if (allPrimitive) {
          for (let i = 0; i < snapKeys.length; i++) {
            const k = snapKeys[i];
            if (k === undefined) throw "JSON_KEY_INVARIANT";
            const v = snapVals[i];
            if (v === undefined) continue;
            emitPropertyKey(k, written, nested);
            appendPrimitive(v);
            written = true;
          }
          if (written && gap !== "") {
            emitByte(10);
            emitText(indent);
          }
          emitByte(125);
          return;
        }
        const objEpoch = object.internalPropertyEpoch;
        for (let i = 0; i < snapKeys.length; i++) {
          const prop = snapKeys[i];
          if (prop === undefined) throw "JSON_KEY_INVARIANT";
          const propValue =
            object.internalPropertyEpoch === objEpoch
              ? snapVals[i]
              : getPropertyChecked(object, prop, realm, hooks);
          if (isSimplePrimitive(propValue)) {
            if (propValue === undefined) continue;
            emitPropertyKey(prop, written, nested);
            appendPrimitive(propValue);
            written = true;
          } else {
            written = appendProperty(prop, propValue, object, nested, written);
          }
        }
        if (written && gap !== "") {
          emitByte(10);
          emitText(indent);
        }
        emitByte(125);
        return;
      }
    }

    const list = propertyList;
    if (
      !hasReplacer &&
      list !== undefined &&
      object.internalMethods === undefined &&
      (rare === undefined || rare.internalDataAliases === undefined) &&
      (object.internalFlags & objectFlagDictionary) === 0
    ) {
      const shape = object.internalShape;
      for (let i = 0; i < list.length; i++) {
        const property = list[i];
        if (property === undefined) throw "JSON_KEY_INVARIANT";
        let propValue: unknown;
        if (shape !== undefined && object.internalShape === shape) {
          const pos = shapeKeyIndex<ScriptPropertyKey, unknown>(
            shape,
            property,
          );
          if (pos >= 0 && ((shape.kinds[pos] ?? 0) & propertyAccessor) === 0) {
            const raw = storedValue<ScriptPropertyKey, unknown>(object, pos);
            propValue = raw === undefined ? shape.undefinedValue : raw;
          } else {
            propValue = getPropertyChecked(object, property, realm, hooks);
          }
        } else {
          propValue = getPropertyChecked(object, property, realm, hooks);
        }
        written = appendProperty(property, propValue, object, nested, written);
      }
      if (written && gap !== "") {
        emitByte(10);
        emitText(indent);
      }
      emitByte(125);
      return;
    }

    let keys = list;
    if (keys === undefined) {
      const selected: string[] = [];
      for (const property of ownKeys<ScriptPropertyKey, unknown>(
        object,
        (key): number => scriptPropertyKeyOrder(key),
      )) {
        if (typeof property !== "string") continue;
        const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
          object,
          property,
        );
        if (descriptor !== undefined && descriptor.enumerable)
          selected.push(property);
      }
      keys = selected;
    }
    for (let i = 0; i < keys.length; i++) {
      const property = keys[i];
      if (property === undefined) throw "JSON_KEY_INVARIANT";
      const propValue = getPropertyChecked(object, property, realm, hooks);
      written = appendProperty(property, propValue, object, nested, written);
    }
    if (written && gap !== "") {
      emitByte(10);
      emitText(indent);
    }
    emitByte(125);
  }

  let holder: ScriptObject | undefined = undefined;
  let rootValue: unknown = value;
  try {
    if (hasReplacer) {
      holder = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
      if (
        !createDataProperty<ScriptPropertyKey, unknown>(
          holder,
          "",
          value,
          hooks,
        )
      )
        throw "JSON_WRAPPER_INVARIANT";
      rootValue = getPropertyChecked(holder, "", realm, hooks);
    }
    if (!serializeValue("", rootValue, holder, "")) return undefined;
    if (useBuf && buf !== undefined) return latin1Text(buf, 0, bufLen);
    return out.join("");
  } finally {
    if (ownsScratch) jsonBufInUse = false;
  }
}
