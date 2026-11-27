import {
  parseJSONText,
  type JSONNode,
} from "@tint/foundation/text/json-syntax";
import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import { createArrayObject } from "./arrays.ts";
import {
  createArray0,
  createArray1,
  createArray2,
  createArray3,
  createArray4,
  createArrayFromList,
  lengthOfArrayLike,
} from "./array-like.ts";
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

function requireJSONText(
  input: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  if (typeof input === "string") return input;
  const converted = stringValue(input, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}

const pow10 = [1, 10, 100, 1000, 10000, 100000, 1000000];

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/** Fast path for a standalone JSON string literal (no surrounding whitespace,
 * exact closing quote at the end). Returns undefined to defer to the full
 * parser on any malformed input or trailing characters. */
export function tryParseJSONStringLiteral(source: string): string | undefined {
  const length = source.length;
  if (
    length < 2 ||
    source.charCodeAt(0) !== 34 ||
    source.charCodeAt(length - 1) !== 34
  )
    return undefined;
  const end = length - 1;
  let i = 1;
  for (; i < end; i++) {
    const c = source.charCodeAt(i);
    if (c < 32 || c === 34) return undefined;
    if (c === 92) break;
  }
  if (i === end) return source.slice(1, end);
  const out = createStringBuilder();
  let start = 1;
  while (i < end) {
    const c = source.charCodeAt(i);
    if (c < 32 || c === 34) return undefined;
    if (c === 92) {
      if (i + 1 >= end) return undefined;
      if (i > start) appendString(out, source.slice(start, i));
      const esc = source.charCodeAt(i + 1);
      if (esc === 34) {
        appendString(out, '"');
        i += 2;
      } else if (esc === 92) {
        appendString(out, "\\");
        i += 2;
      } else if (esc === 47) {
        appendString(out, "/");
        i += 2;
      } else if (esc === 98) {
        appendString(out, "\b");
        i += 2;
      } else if (esc === 102) {
        appendString(out, "\f");
        i += 2;
      } else if (esc === 110) {
        appendString(out, "\n");
        i += 2;
      } else if (esc === 114) {
        appendString(out, "\r");
        i += 2;
      } else if (esc === 116) {
        appendString(out, "\t");
        i += 2;
      } else if (esc === 117) {
        if (i + 5 >= end) return undefined;
        const h0 = hexNibble(source.charCodeAt(i + 2)),
          h1 = hexNibble(source.charCodeAt(i + 3)),
          h2 = hexNibble(source.charCodeAt(i + 4)),
          h3 = hexNibble(source.charCodeAt(i + 5));
        if ((h0 | h1 | h2 | h3) < 0) return undefined;
        appendString(
          out,
          String.fromCharCode((h0 << 12) | (h1 << 8) | (h2 << 4) | h3),
        );
        i += 6;
      } else return undefined;
      start = i;
    } else i++;
  }
  if (start < end) appendString(out, source.slice(start, end));
  return finishString(out);
}

/** Direct recursive-descent JSON parser realizing realm objects/arrays with
 * zero JSONBuilder indirect dispatch and fast small-array/short-decimal paths. */
function parseJSONDirect(
  source: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const length = source.length;
  let position = 0;
  function skipWhitespace(): void {
    while (position < length) {
      const unit = source.charCodeAt(position);
      if (unit !== 32 && unit !== 9 && unit !== 10 && unit !== 13) break;
      position++;
    }
  }
  function syntaxError(): never {
    throw createRuntimeError(realm, "syntax");
  }
  function parseString(): string {
    if (source.charCodeAt(position) !== 34) syntaxError();
    position++;
    const begin = position;
    while (position < length) {
      const unit = source.charCodeAt(position);
      if (unit === 34) {
        position++;
        return source.slice(begin, position - 1);
      }
      if (unit === 92 || unit < 32) break;
      position++;
    }
    const out = createStringBuilder();
    let start = begin;
    while (position < length) {
      const unit = source.charCodeAt(position++);
      if (unit === 34) {
        if (position - 1 > start)
          appendString(out, source.slice(start, position - 1));
        return finishString(out);
      }
      if (unit < 32) syntaxError();
      if (unit !== 92) continue;
      if (position - 1 > start)
        appendString(out, source.slice(start, position - 1));
      if (position >= length) syntaxError();
      const esc = source.charCodeAt(position++);
      if (esc === 34) appendString(out, '"');
      else if (esc === 92) appendString(out, "\\");
      else if (esc === 47) appendString(out, "/");
      else if (esc === 98) appendString(out, "\b");
      else if (esc === 102) appendString(out, "\f");
      else if (esc === 110) appendString(out, "\n");
      else if (esc === 114) appendString(out, "\r");
      else if (esc === 116) appendString(out, "\t");
      else if (esc === 117) {
        if (position + 4 > length) syntaxError();
        const h0 = hexNibble(source.charCodeAt(position)),
          h1 = hexNibble(source.charCodeAt(position + 1)),
          h2 = hexNibble(source.charCodeAt(position + 2)),
          h3 = hexNibble(source.charCodeAt(position + 3));
        if ((h0 | h1 | h2 | h3) < 0) syntaxError();
        position += 4;
        appendString(
          out,
          String.fromCharCode((h0 << 12) | (h1 << 8) | (h2 << 4) | h3),
        );
      } else syntaxError();
      start = position;
    }
    syntaxError();
  }
  function parseArray(): OrdinaryObject<ScriptPropertyKey, unknown> {
    position++;
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    if (source.charCodeAt(position) === 93) {
      position++;
      return createArray0(realm);
    }
    const e0 = parseValue();
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    let sep = source.charCodeAt(position);
    if (sep === 93) {
      position++;
      return createArray1(e0, realm);
    }
    if (sep !== 44) syntaxError();
    position++;
    const e1 = parseValue();
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    sep = source.charCodeAt(position);
    if (sep === 93) {
      position++;
      return createArray2(e0, e1, realm);
    }
    if (sep !== 44) syntaxError();
    position++;
    const e2 = parseValue();
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    sep = source.charCodeAt(position);
    if (sep === 93) {
      position++;
      return createArray3(e0, e1, e2, realm);
    }
    if (sep !== 44) syntaxError();
    position++;
    const e3 = parseValue();
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    sep = source.charCodeAt(position);
    if (sep === 93) {
      position++;
      return createArray4(e0, e1, e2, e3, realm);
    }
    if (sep !== 44) syntaxError();
    position++;
    const elements: unknown[] = [e0, e1, e2, e3];
    while (true) {
      elements.push(parseValue());
      if (source.charCodeAt(position) <= 32) skipWhitespace();
      const next = source.charCodeAt(position);
      if (next === 93) {
        position++;
        return createArrayFromList(
          elements,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
      }
      if (next !== 44) syntaxError();
      position++;
    }
  }
  function parseObject(): OrdinaryObject<ScriptPropertyKey, unknown> {
    position++;
    const object = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    if (source.charCodeAt(position) === 125) {
      position++;
      return object;
    }
    while (true) {
      if (source.charCodeAt(position) <= 32) skipWhitespace();
      const key = parseString();
      if (source.charCodeAt(position) <= 32) skipWhitespace();
      if (source.charCodeAt(position++) !== 58) syntaxError();
      const child = parseValue();
      createDataProperty<ScriptPropertyKey, unknown>(object, key, child, hooks);
      if (source.charCodeAt(position) <= 32) skipWhitespace();
      const next = source.charCodeAt(position);
      if (next === 125) {
        position++;
        return object;
      }
      if (next !== 44) syntaxError();
      position++;
    }
  }
  function parseValue(): unknown {
    if (source.charCodeAt(position) <= 32) skipWhitespace();
    const start = position;
    const first = source.charCodeAt(position);
    if (first === 34) return parseString();
    if (first === 123) return parseObject();
    if (first === 91) return parseArray();
    if (
      first === 116 &&
      position + 4 <= length &&
      source.charCodeAt(position + 1) === 114 &&
      source.charCodeAt(position + 2) === 117 &&
      source.charCodeAt(position + 3) === 101
    ) {
      position += 4;
      return true;
    }
    if (
      first === 102 &&
      position + 5 <= length &&
      source.charCodeAt(position + 1) === 97 &&
      source.charCodeAt(position + 2) === 108 &&
      source.charCodeAt(position + 3) === 115 &&
      source.charCodeAt(position + 4) === 101
    ) {
      position += 5;
      return false;
    }
    if (
      first === 110 &&
      position + 4 <= length &&
      source.charCodeAt(position + 1) === 117 &&
      source.charCodeAt(position + 2) === 108 &&
      source.charCodeAt(position + 3) === 108
    ) {
      position += 4;
      return null;
    }
    const negative = first === 45;
    if (negative) position++;
    let intValue = 0;
    let totalDigits = 0;
    const head = source.charCodeAt(position);
    if (head === 48) {
      position++;
      totalDigits = 1;
    } else {
      if (head < 48 || head > 57) syntaxError();
      intValue = head - 48;
      totalDigits = 1;
      position++;
      while (position < length) {
        const c = source.charCodeAt(position);
        if (c < 48 || c > 57) break;
        if (totalDigits < 15) intValue = intValue * 10 + (c - 48);
        totalDigits++;
        position++;
      }
    }
    let fracDigits = 0;
    if (source.charCodeAt(position) === 46) {
      position++;
      const d0 = source.charCodeAt(position);
      if (d0 < 48 || d0 > 57) syntaxError();
      if (totalDigits < 15) intValue = intValue * 10 + (d0 - 48);
      totalDigits++;
      fracDigits = 1;
      position++;
      while (position < length) {
        const c = source.charCodeAt(position);
        if (c < 48 || c > 57) break;
        if (totalDigits < 15) intValue = intValue * 10 + (c - 48);
        totalDigits++;
        fracDigits++;
        position++;
      }
    }
    let hasExp = false;
    const exp = source.charCodeAt(position);
    if (exp === 101 || exp === 69) {
      hasExp = true;
      position++;
      const sign = source.charCodeAt(position);
      if (sign === 43 || sign === 45) position++;
      const e0 = source.charCodeAt(position);
      if (e0 < 48 || e0 > 57) syntaxError();
      position++;
      while (position < length) {
        const c = source.charCodeAt(position);
        if (c < 48 || c > 57) break;
        position++;
      }
    }
    if (!hasExp && totalDigits <= 15) {
      if (fracDigits === 0) return negative ? -intValue : intValue;
      if (fracDigits <= 6) {
        const scale = pow10[fracDigits];
        if (scale !== undefined) {
          const val = intValue / scale;
          return negative ? -val : val;
        }
      }
    }
    return Number(source.slice(start, position));
  }
  const result = parseValue();
  skipWhitespace();
  if (position !== length) syntaxError();
  return result;
}

/** Realize a JSON tree, retaining the original values for reviver source contexts. */
export function parseJSON(
  input: unknown,
  reviver: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const source = requireJSONText(input, realm, hooks);
  // Without a callable reviver no source context is observable, so values are
  // realized directly during the parse instead of through a retained syntax
  // tree and record tree (which cost several objects per element). IsCallable
  // has no side effects, and partially built values from malformed text are
  // unobservable garbage.
  if (
    reviver === undefined ||
    reviver === null ||
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(reviver, realm.objectPrototype),
    )
  ) {
    const fastString = tryParseJSONStringLiteral(source);
    if (fastString !== undefined) return fastString;
    return parseJSONDirect(source, realm, hooks);
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
  // Only reached with a callable reviver: records retain source contexts.
  const rootRecord = realize(rootNode, "");
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
