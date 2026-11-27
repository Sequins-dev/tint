import { pushQuotedJSONString } from "./json-string.ts";
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
  if (object.internalArrayElements !== undefined) {
    if (!arrayProtoClean || object.prototype !== realm.arrayPrototype)
      return false;
    const props = object.properties;
    return props === undefined || !props.has("toJSON");
  }
  if (object.internalMethods !== undefined) return false;
  if (!objectProtoClean || object.prototype !== realm.objectPrototype)
    return false;
  if ((object.internalFlags & objectFlagDictionary) === 0) {
    const shape = object.internalShape;
    return shape === undefined || !shapeHasToJSON(shape);
  }
  const props = object.properties;
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
  const hasReplacer = isCallable(replacer, realm);
  let propertyList: string[] | undefined = undefined;
  if (!hasReplacer && isArrayValue(replacer, realm)) {
    const list: string[] = [];
    const array = viewObjectValue(replacer, realm.objectPrototype);
    if (array === undefined) throw "JSON_REPLACER_INVARIANT";
    const rawPacked = array.internalArrayElements;
    const packedReplacer =
      rawPacked !== undefined &&
      array.prototype === realm.arrayPrototype &&
      arrayElementCount<ScriptPropertyKey, unknown>(rawPacked) ===
        rawPacked.length
        ? rawPacked
        : undefined;
    const length =
      packedReplacer !== undefined
        ? packedReplacer.length
        : lengthOfArrayLike(array, realm, hooks);
    for (let i = 0; i < length; i++) {
      const item =
        packedReplacer !== undefined
          ? readArrayElement<ScriptPropertyKey, unknown>(packedReplacer, i)
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
  const objectProtoClean = !prototypeChainHasToJSON(realm.objectPrototype);
  const arrayProtoClean =
    objectProtoClean && !prototypeChainHasToJSON(realm.arrayPrototype);

  const out: string[] = [];
  const stack: ScriptObject[] = [];

  function appendPrimitive(current: unknown): boolean {
    if (current === null) {
      out.push("null");
      return true;
    }
    if (typeof current === "boolean") {
      out.push(current ? "true" : "false");
      return true;
    }
    if (typeof current === "string") {
      pushQuotedJSONString(out, current);
      return true;
    }
    if (typeof current === "number") {
      out.push(Number.isFinite(current) ? String(current) : "null");
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
      const exotic = object.internalExoticSlots;
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
      out.push("null");
      return true;
    }
    if (typeof current === "boolean") {
      out.push(current ? "true" : "false");
      return true;
    }
    if (typeof current === "string") {
      pushQuotedJSONString(out, current);
      return true;
    }
    if (typeof current === "number") {
      out.push(Number.isFinite(current) ? String(current) : "null");
      return true;
    }
    if (object === undefined) {
      if (viewBigIntValue(current) !== undefined)
        throw createRuntimeError(realm, "type");
      return false;
    }
    const exotic = object.internalExoticSlots;
    const raw = exotic === undefined ? undefined : exotic.internalRawJSON;
    if (raw !== undefined) {
      out.push(raw);
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
    const packed = object.internalArrayElements;
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
        out.push("[]");
        return;
      }
      const sep = gap === "" ? "," : ",\n" + nested;
      out.push(gap === "" ? "[" : "[\n" + nested);
      if (packed.generalCount === 0) {
        const numbers = packed.numbers;
        for (let i = 0; i < length; i++) {
          if (i > 0) out.push(sep);
          const n = numbers[i];
          out.push(n !== undefined && Number.isFinite(n) ? String(n) : "null");
        }
      } else {
        for (let i = 0; i < length; i++) {
          if (i > 0) out.push(sep);
          const elem = readArrayElement<ScriptPropertyKey, unknown>(packed, i);
          if (isSimplePrimitive(elem)) {
            if (elem === undefined || !appendPrimitive(elem)) out.push("null");
          } else {
            if (!serializeValue(indexKey(i), elem, object, nested))
              out.push("null");
          }
        }
      }
      if (gap !== "") out.push("\n", indent);
      out.push("]");
      return;
    }
    const props = object.properties;
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
          out.push("[]");
          return;
        }
        const sep = gap === "" ? "," : ",\n" + nested;
        out.push(gap === "" ? "[" : "[\n" + nested);
        for (let i = 0; i < length; i++) {
          if (i > 0) out.push(sep);
          const key = indexKey(i);
          const desc = object.properties === props ? props.get(key) : undefined;
          let elem: unknown;
          if (desc !== undefined && !desc.accessor) elem = desc.value;
          else elem = getPropertyChecked(object, key, realm, hooks);
          if (isSimplePrimitive(elem)) {
            if (elem === undefined || !appendPrimitive(elem)) out.push("null");
          } else {
            if (!serializeValue(key, elem, object, nested)) out.push("null");
          }
        }
        if (gap !== "") out.push("\n", indent);
        out.push("]");
        return;
      }
    }
    const length = lengthOfArrayLike(object, realm, hooks);
    if (length === 0) {
      out.push("[]");
      return;
    }
    const sep = gap === "" ? "," : ",\n" + nested;
    out.push(gap === "" ? "[" : "[\n" + nested);
    for (let i = 0; i < length; i++) {
      if (i > 0) out.push(sep);
      const key = indexKey(i);
      const elem = getPropertyChecked(object, key, realm, hooks);
      if (!serializeValue(key, elem, object, nested)) out.push("null");
    }
    if (gap !== "") out.push("\n", indent);
    out.push("]");
  }

  function appendProperty(
    key: string,
    propValue: unknown,
    object: ScriptObject,
    nested: string,
    written: boolean,
  ): boolean {
    if (!hasReplacer && propValue === undefined) return written;
    const mark = out.length;
    if (gap === "") {
      if (written) out.push(",");
      pushQuotedJSONString(out, key);
      out.push(":");
    } else {
      out.push(written ? ",\n" : "\n", nested);
      pushQuotedJSONString(out, key);
      out.push(": ");
    }
    if (!serializeValue(key, propValue, object, nested)) {
      while (out.length > mark) out.pop();
      return written;
    }
    return true;
  }

  function serializeObject(
    object: ScriptObject,
    indent: string,
    nested: string,
  ): void {
    out.push("{");
    let written = false;
    const rare = object.internalRareSlots;
    const plain =
      !hasReplacer &&
      propertyList === undefined &&
      object.internalMethods === undefined &&
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
          written = appendProperty(prop, propValue, object, nested, written);
        }
      }
      if (written && gap !== "") out.push("\n", indent);
      out.push("}");
      return;
    }

    if (plain && (object.internalFlags & objectFlagDictionary) !== 0) {
      const props = object.properties;
      if (props === undefined || props.size === 0) {
        out.push("}");
        return;
      }
      let fastDict = true;
      let allPrimitive = true;
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
        if (desc.enumerable && !isSimplePrimitive(desc.value))
          allPrimitive = false;
      }
      if (fastDict) {
        if (allPrimitive) {
          for (const [k, desc] of props) {
            if (typeof k !== "string" || !desc.enumerable) continue;
            const v = desc.value;
            if (v === undefined) continue;
            if (gap === "") {
              if (written) out.push(",");
              pushQuotedJSONString(out, k);
              out.push(":");
            } else {
              out.push(written ? ",\n" : "\n", nested);
              pushQuotedJSONString(out, k);
              out.push(": ");
            }
            appendPrimitive(v);
            written = true;
          }
          if (written && gap !== "") out.push("\n", indent);
          out.push("}");
          return;
        }
        const snapKeys: string[] = [];
        const snapVals: unknown[] = [];
        for (const [k, desc] of props) {
          if (typeof k !== "string" || !desc.enumerable) continue;
          snapKeys.push(k);
          snapVals.push(desc.value);
        }
        const objEpoch = object.internalPropertyEpoch;
        for (let i = 0; i < snapKeys.length; i++) {
          const prop = snapKeys[i];
          if (prop === undefined) throw "JSON_KEY_INVARIANT";
          const propValue =
            object.internalPropertyEpoch === objEpoch
              ? snapVals[i]
              : getPropertyChecked(object, prop, realm, hooks);
          written = appendProperty(prop, propValue, object, nested, written);
        }
        if (written && gap !== "") out.push("\n", indent);
        out.push("}");
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
      if (written && gap !== "") out.push("\n", indent);
      out.push("}");
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
    if (written && gap !== "") out.push("\n", indent);
    out.push("}");
  }

  let holder: ScriptObject | undefined = undefined;
  let rootValue: unknown = value;
  if (hasReplacer) {
    holder = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(holder, "", value, hooks)
    )
      throw "JSON_WRAPPER_INVARIANT";
    rootValue = getPropertyChecked(holder, "", realm, hooks);
  }
  if (!serializeValue("", rootValue, holder, "")) return undefined;
  return out.join("");
}
