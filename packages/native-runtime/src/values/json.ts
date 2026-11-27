import {
  parseJSONText,
  parseJSONWith,
  type JSONNode,
} from "@tint/foundation/text/json-syntax";
import {
  callObjectValue,
  createArrayObject,
  createDataProperty,
  createObject,
  createRuntimeError,
  deleteProperty,
  exoticSlots,
  getObjectValuePropertyOrThrow,
  getOwnProperty,
  getProperty,
  installProgramArrayIntrinsics,
  installProgramConstructorGroup,
  installProgramObjectIntrinsics,
  isArrayValue,
  isCallableObject,
  lengthOfArrayLike,
  numberValue,
  ownKeys,
  programRealmCore,
  rejectUnsupportedExecution,
  sameValue,
  scriptPropertyKeyOrder,
  stringValue,
  viewBigIntValue,
  viewObjectValue,
  type OrdinaryObject,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";

type ObjectRecord = OrdinaryObject<ScriptPropertyKey, unknown>;

interface ParseRecord {
  readonly key: string;
  readonly node: JSONNode;
  readonly value: unknown;
  readonly children: readonly ParseRecord[];
}

function hexEscape(code: number): string {
  const digits = "0123456789abcdef";
  return (
    "\\u" +
    digits.charAt((code >>> 12) & 0xf) +
    digits.charAt((code >>> 8) & 0xf) +
    digits.charAt((code >>> 4) & 0xf) +
    digits.charAt(code & 0xf)
  );
}

/** ECMAScript QuoteJSONString (including lone surrogate escaping). */
function quoteJSONString(text: string): string {
  const length = text.length;
  let index = 0;
  while (index < length) {
    const code = text.charCodeAt(index);
    if (
      code < 32 ||
      code === 34 ||
      code === 92 ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      break;
    index++;
  }
  if (index === length) return '"' + text + '"';
  const parts: string[] = ['"'];
  let start = 0;
  for (let i = index; i < length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          continue;
        }
      }
      if (i > start) parts.push(text.slice(start, i));
      parts.push(hexEscape(code));
      start = i + 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      if (i > start) parts.push(text.slice(start, i));
      parts.push(hexEscape(code));
      start = i + 1;
      continue;
    }
    let escaped: string | undefined;
    if (code === 34) escaped = '\\"';
    else if (code === 92) escaped = "\\\\";
    else if (code === 8) escaped = "\\b";
    else if (code === 12) escaped = "\\f";
    else if (code === 10) escaped = "\\n";
    else if (code === 13) escaped = "\\r";
    else if (code === 9) escaped = "\\t";
    else if (code < 32) escaped = hexEscape(code);
    if (escaped !== undefined) {
      if (i > start) parts.push(text.slice(start, i));
      parts.push(escaped);
      start = i + 1;
    }
  }
  if (start < length) parts.push(text.slice(start));
  parts.push('"');
  return parts.join("");
}

/** Typed `JSON.stringify(value, replacer?, space?)` backed by the program realm. */
export function jsonStringify(
  value: unknown,
  replacer: unknown,
  space: unknown,
): string | undefined {
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  installProgramArrayIntrinsics(core);
  installProgramConstructorGroup(core, "installErrorIntrinsics");
  const realm = core.realm,
    hooks = core.hooks;

  function callable(candidate: unknown): boolean {
    return isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(candidate, realm.objectPrototype),
    );
  }
  function get(target: unknown, key: string): unknown {
    return getObjectValuePropertyOrThrow(target, key, hooks, realm);
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
  function toStringVal(input: unknown): string {
    const result = stringValue(input, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }
  function toNumberVal(input: unknown): number {
    const result = numberValue(input, hooks, realm);
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
        object === undefined
          ? undefined
          : exoticSlots(object).internalPrimitiveData;
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        !(
          data !== undefined &&
          (data.kind === "string" || data.kind === "number")
        )
      )
        continue;
      const key = toStringVal(item);
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
    if (spaceData.kind === "number") spacing = toNumberVal(spacing);
    else if (spaceData.kind === "string") spacing = toStringVal(spacing);
  }
  let gap = "";
  if (typeof spacing === "number") {
    if (spacing > 0) gap = " ".repeat(Math.min(Math.trunc(spacing), 10));
  } else if (typeof spacing === "string") gap = spacing.slice(0, 10);

  const stack: ObjectRecord[] = [];
  function serialize(
    key: string,
    holder: ObjectRecord,
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
    const data =
      boxed === undefined
        ? undefined
        : exoticSlots(boxed).internalPrimitiveData;
    if (data !== undefined) {
      if (data.kind === "number") current = toNumberVal(current);
      else if (data.kind === "string") current = toStringVal(current);
      else if (data.kind === "boolean" || data.kind === "bigint")
        current = data.value;
    }
    if (current === null) return "null";
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "string") return quoteJSONString(current);
    if (typeof current === "number")
      return Number.isFinite(current) ? String(current) : "null";
    if (viewBigIntValue(current) !== undefined)
      throw createRuntimeError(realm, "type");
    const object = viewObjectValue(current, realm.objectPrototype);
    if (object === undefined) return undefined;
    const raw = exoticSlots(object).internalRawJSON;
    if (raw !== undefined) return raw;
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
            (prop): number => scriptPropertyKeyOrder(prop),
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

/** Typed `JSON.parse(text, reviver?)` backed by the program realm. */
export function jsonParse(input: unknown, reviver: unknown): unknown {
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  installProgramArrayIntrinsics(core);
  installProgramConstructorGroup(core, "installErrorIntrinsics");
  const realm = core.realm,
    hooks = core.hooks;

  const converted = stringValue(input, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  const source = converted.value;

  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(reviver, realm.objectPrototype),
    )
  ) {
    const direct = parseJSONWith<
      unknown,
      { readonly object: ObjectRecord; length: number },
      ObjectRecord
    >(source, {
      null: (_start, _end): unknown => null,
      boolean: (value, _start, _end): unknown => value,
      number: (text, _start, _end): unknown => Number(text),
      string: (value, _start, _end): unknown => value,
      openArray: (_start) => ({
        object: createArrayObject<ScriptPropertyKey, unknown>(
          0,
          realm.arrayPrototype,
          realm.arrayHooks,
          hooks,
        ),
        length: 0,
      }),
      element: (array, value): void => {
        createDataProperty<ScriptPropertyKey, unknown>(
          array.object,
          String(array.length),
          value,
          hooks,
        );
        array.length++;
      },
      closeArray: (array, _start, _end): unknown => array.object,
      openObject: (_start) =>
        createObject<ScriptPropertyKey, unknown>(realm.objectPrototype),
      entry: (object, key, value): void => {
        createDataProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          value,
          hooks,
        );
      },
      closeObject: (object, _start, _end): unknown => object,
    });
    if (!direct.ok) throw createRuntimeError(realm, "syntax");
    return direct.value;
  }

  const parsed = parseJSONText(source),
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
  function internalize(
    holder: ObjectRecord,
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
    const matched = record !== undefined && sameValue(record.value, value);
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
          (prop): number => scriptPropertyKeyOrder(prop),
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
