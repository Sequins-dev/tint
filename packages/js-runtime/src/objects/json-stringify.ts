import { quoteJSONString } from "./json-string.ts";
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
import {
  createObject,
  createDataProperty,
  ownKeys,
  getOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Observable JSON serialization uses the ordinary property/call protocols. */
export function stringifyJSON(
  value: unknown,
  replacer: unknown,
  space: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  function callable(value: unknown): boolean {
    return isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(value, realm.objectPrototype),
    );
  }
  function get(value: unknown, key: string): unknown {
    const result = getObjectValueProperty(value, key, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function call(
    method: unknown,
    receiver: unknown,
    args: readonly unknown[],
  ): unknown {
    const result = callObjectValue(
      method,
      receiver,
      args,
      realm.objectPrototype,
    );
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function string(value: unknown): string {
    const result = stringValue(value, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function number(value: unknown): number {
    const result = numberValue(value, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  const hasReplacer = callable(replacer);
  let propertyList: string[] | undefined = undefined;
  if (!hasReplacer && isArrayValue(replacer, realm)) {
    const list: string[] = [];
    const array = viewObjectValue(replacer, realm.objectPrototype);
    if (array === undefined) throw "JSON_REPLACER_INVARIANT";
    const length = lengthOfArrayLike(array, realm, hooks);
    for (let i = 0; i < length; i++) {
      const item = get(replacer, String(i));
      const object = viewObjectValue(item, realm.objectPrototype);
      const data =
        object === undefined ? undefined : object.internalPrimitiveData;
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        !(
          data !== undefined &&
          (data.kind === "string" || data.kind === "number")
        )
      )
        continue;
      const key = string(item);
      if (!list.includes(key)) list.push(key);
    }
    propertyList = list;
  }
  let spacing = space;
  const spaceObject = viewObjectValue(spacing, realm.objectPrototype);
  const spaceData =
    spaceObject === undefined ? undefined : spaceObject.internalPrimitiveData;
  if (spaceData !== undefined) {
    if (spaceData.kind === "number") spacing = number(spacing);
    else if (spaceData.kind === "string") spacing = string(spacing);
  }
  let gap = "";
  if (typeof spacing === "number") {
    if (spacing > 0) gap = " ".repeat(Math.min(Math.trunc(spacing), 10));
  } else if (typeof spacing === "string") gap = spacing.slice(0, 10);
  const stack: OrdinaryObject<ScriptPropertyKey, unknown>[] = [];
  function serialize(
    key: string,
    holder: OrdinaryObject<ScriptPropertyKey, unknown>,
    indent: string,
  ): string | undefined {
    let current = get(holder, key);
    if (
      viewObjectValue(current, realm.objectPrototype) !== undefined ||
      viewBigIntValue(current) !== undefined
    ) {
      const method = get(current, "toJSON");
      if (callable(method)) current = call(method, current, [key]);
    }
    if (hasReplacer) current = call(replacer, holder, [key, current]);
    const boxed = viewObjectValue(current, realm.objectPrototype);
    const data = boxed === undefined ? undefined : boxed.internalPrimitiveData;
    if (data !== undefined) {
      if (data.kind === "number") current = number(current);
      else if (data.kind === "string") current = string(current);
      else if (data.kind === "boolean" || data.kind === "bigint")
        current = data.value;
    }
    if (current === null) return "null";
    if (current === true) return "true";
    if (current === false) return "false";
    if (typeof current === "string") return quoteJSONString(current);
    if (typeof current === "number")
      return Number.isFinite(current) ? String(current) : "null";
    if (viewBigIntValue(current) !== undefined)
      throw createRuntimeError(realm, "type");
    const object = viewObjectValue(current, realm.objectPrototype);
    if (object === undefined) return undefined;
    if (object.internalRawJSON !== undefined) return object.internalRawJSON;
    if (callable(current)) return undefined;
    if (stack.includes(object)) throw createRuntimeError(realm, "type");
    stack.push(object);
    try {
      const array = isArrayValue(current, realm),
        nested = indent + gap,
        parts: string[] = [];
      if (array) {
        const length = lengthOfArrayLike(object, realm, hooks);
        for (let i = 0; i < length; i++) {
          const part = serialize(String(i), object, nested);
          parts.push(part === undefined ? "null" : part);
        }
      } else {
        let keys = propertyList;
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
        for (const property of keys) {
          if (property === undefined) throw "JSON_KEY_INVARIANT";
          const part = serialize(property, object, nested);
          if (part !== undefined)
            parts.push(
              quoteJSONString(property) + ":" + (gap === "" ? "" : " ") + part,
            );
        }
      }
      const open = array ? "[" : "{",
        close = array ? "]" : "}";
      if (parts.length === 0) return open + close;
      if (gap === "") return open + parts.join(",") + close;
      return (
        open +
        "\n" +
        nested +
        parts.join(",\n" + nested) +
        "\n" +
        indent +
        close
      );
    } finally {
      stack.pop();
    }
  }
  const holder = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  if (!createDataProperty<ScriptPropertyKey, unknown>(holder, "", value, hooks))
    throw "JSON_WRAPPER_INVARIANT";
  return serialize("", holder, "");
}
