import {
  parseJSONText,
  type JSONNode,
} from "@tint/foundation/text/json-syntax";
import { createArrayObject } from "./arrays.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import { stringValue } from "./coercion.ts";
import { isCallableObject } from "./call.ts";
import {
  viewObjectValue,
  callObjectValue,
  isArrayValue,
  scriptSameValue,
} from "./values.ts";
import {
  createObject,
  createDataProperty,
  getProperty,
  deleteProperty,
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
interface ParseRecord {
  readonly key: string;
  readonly node: JSONNode;
  readonly value: unknown;
  readonly children: readonly ParseRecord[];
}

/** Realize a JSON tree, retaining the original values for reviver source contexts. */
export function parseJSON(
  input: unknown,
  reviver: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const converted = stringValue(input, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  const source = converted.value,
    parsed = parseJSONText(source),
    rootNode = parsed.node;
  if (rootNode === undefined) throw createRuntimeError(realm, "syntax");
  function realize(node: JSONNode, key: string): ParseRecord {
    const children: ParseRecord[] = [];
    let value: unknown = undefined;
    if (node.kind === "null") value = null;
    else if (node.kind === "boolean") value = node.value;
    else if (node.kind === "string") value = node.value;
    else if (node.kind === "number") value = Number(node.text);
    else {
      const object =
        node.kind === "array"
          ? createArrayObject<ScriptPropertyKey, unknown>(
              node.elements.length,
              realm.arrayPrototype,
              realm.arrayHooks,
              hooks,
            )
          : createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
      if (node.kind === "array") {
        for (let i = 0; i < node.elements.length; i++) {
          const childNode = node.elements[i];
          if (childNode === undefined) throw "JSON_ELEMENT_INVARIANT";
          const child = realize(childNode, String(i));
          children.push(child);
          createDataProperty<ScriptPropertyKey, unknown>(
            object,
            child.key,
            child.value,
            hooks,
          );
        }
      } else {
        for (const entry of node.entries) {
          if (entry === undefined) throw "JSON_ENTRY_INVARIANT";
          const child = realize(entry.value, entry.key);
          children.push(child);
          createDataProperty<ScriptPropertyKey, unknown>(
            object,
            child.key,
            child.value,
            hooks,
          );
        }
      }
      value = object;
    }
    return { key, node, value, children };
  }
  const rootRecord = realize(rootNode, "");
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(reviver, realm.objectPrototype),
    )
  )
    return rootRecord.value;
  function internalize(
    holder: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: string,
    record: ParseRecord | undefined,
  ): unknown {
    const value = getProperty<ScriptPropertyKey, unknown>(
      holder,
      key,
      holder,
      hooks,
    );
    const context = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    const matched =
      record !== undefined && scriptSameValue(record.value, value);
    const object = viewObjectValue(value, realm.objectPrototype);
    if (matched && record !== undefined && object === undefined)
      createDataProperty<ScriptPropertyKey, unknown>(
        context,
        "source",
        source.slice(record.node.start, record.node.end),
        hooks,
      );
    if (object !== undefined) {
      const target = object;
      const children: readonly ParseRecord[] =
        matched && record !== undefined ? record.children : [];
      function visit(name: string): void {
        let child: ParseRecord | undefined = undefined;
        for (let i = children.length - 1; i >= 0; i--) {
          const candidate = children[i];
          if (candidate !== undefined && candidate.key === name) {
            child = candidate;
            break;
          }
        }
        const replacement = internalize(target, name, child);
        if (replacement === undefined)
          deleteProperty<ScriptPropertyKey, unknown>(target, name);
        else
          createDataProperty<ScriptPropertyKey, unknown>(
            target,
            name,
            replacement,
            hooks,
          );
      }
      if (isArrayValue(value, realm)) {
        const length = lengthOfArrayLike(object, realm, hooks);
        for (let i = 0; i < length; i++) visit(String(i));
      } else {
        const keys: string[] = [];
        for (const name of ownKeys<ScriptPropertyKey, unknown>(
          object,
          (key): number => scriptPropertyKeyOrder(key),
        )) {
          if (typeof name !== "string") continue;
          const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
            object,
            name,
          );
          if (descriptor !== undefined && descriptor.enumerable)
            keys.push(name);
        }
        for (const name of keys) {
          if (name === undefined) throw "JSON_KEY_INVARIANT";
          visit(name);
        }
      }
    }
    const result = callObjectValue(
      reviver,
      holder,
      [key, value, context],
      realm.objectPrototype,
    );
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  const holder = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    holder,
    "",
    rootRecord.value,
    hooks,
  );
  return internalize(holder, "", rootRecord);
}
