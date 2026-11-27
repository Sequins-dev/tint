/** Syntax-only JSON tree. Duplicate object entries and UTF16 source spans are retained. */
export type JSONNode = { readonly start: number; readonly end: number } & (
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "array"; readonly elements: readonly JSONNode[] }
  | { readonly kind: "object"; readonly entries: readonly JSONEntry[] }
);
export interface JSONEntry {
  readonly key: string;
  readonly value: JSONNode;
}
export interface JSONParseResult {
  readonly node: JSONNode | undefined;
  readonly offset: number;
}

/** Value construction callbacks for parseJSONWith, called in source order.
 * A container is opened, receives its children, then closes into a value.
 * Spans are UTF16 offsets. Callbacks must not observe partially parsed input
 * semantically: malformed text discards everything built so far. */
export interface JSONBuilder<Value, ArrayState, ObjectState> {
  null(start: number, end: number): Value;
  boolean(value: boolean, start: number, end: number): Value;
  number(text: string, start: number, end: number): Value;
  /** Optional fast path when the caller only needs the numeric value (not the
   * raw source text slice), allowing plain integers to parse without slicing. */
  numberValue?(value: number, start: number, end: number): Value;
  string(value: string, start: number, end: number): Value;
  openArray(start: number): ArrayState;
  element(array: ArrayState, value: Value): void;
  closeArray(array: ArrayState, start: number, end: number): Value;
  openObject(start: number): ObjectState;
  entry(object: ObjectState, key: string, value: Value): void;
  closeObject(object: ObjectState, start: number, end: number): Value;
}
export interface JSONBuildResult<Value> {
  readonly value: Value | undefined;
  readonly ok: boolean;
  readonly offset: number;
}

/** No host parsing/evaluation or coercion; the builder decides what is
 * constructed. Malformed input returns ok false. */
export function parseJSONWith<Value, ArrayState, ObjectState>(
  source: string,
  builder: JSONBuilder<Value, ArrayState, ObjectState>,
): JSONBuildResult<Value> {
  const length = source.length;
  const directNumber = builder.numberValue;
  let position = 0;
  function whitespace(): void {
    while (position < length) {
      const unit = source.charCodeAt(position);
      if (unit !== 32 && unit !== 9 && unit !== 10 && unit !== 13) break;
      position++;
    }
  }
  function digit(): boolean {
    const code = source.charCodeAt(position);
    return code >= 48 && code <= 57;
  }
  function string(): string | undefined {
    if (source.charCodeAt(position) !== 34) return undefined;
    position++;
    // A string without escapes is one slice of the source.
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
    const parts: string[] = [];
    let start = begin;
    while (position < length) {
      const unit = source.charCodeAt(position++);
      if (unit === 34) {
        parts.push(source.slice(start, position - 1));
        return parts.join("");
      }
      if (unit < 32) return undefined;
      if (unit !== 92) continue;
      parts.push(source.slice(start, position - 1));
      const escape = source.charCodeAt(position++);
      if (escape === 34) parts.push('"');
      else if (escape === 92) parts.push("\\");
      else if (escape === 47) parts.push("/");
      else if (escape === 98) parts.push("\b");
      else if (escape === 102) parts.push("\f");
      else if (escape === 110) parts.push("\n");
      else if (escape === 114) parts.push("\r");
      else if (escape === 116) parts.push("\t");
      else if (escape === 117) {
        let value = 0;
        for (let i = 0; i < 4; i++) {
          const code = source.charCodeAt(position++);
          const hex =
            code >= 48 && code <= 57
              ? code - 48
              : code >= 65 && code <= 70
                ? code - 55
                : code >= 97 && code <= 102
                  ? code - 87
                  : -1;
          if (hex < 0) return undefined;
          value = value * 16 + hex;
        }
        parts.push(String.fromCharCode(value));
      } else return undefined;
      start = position;
    }
    return undefined;
  }
  // Malformed input clears ok; value() then returns an unused placeholder and
  // every caller stops at the next check (Value itself may be any type).
  let ok = true;
  function fail(start: number): Value {
    ok = false;
    return builder.null(start, start);
  }
  function value(): Value {
    whitespace();
    const start = position,
      first = source.charCodeAt(position);
    if (first === 34) {
      const decoded = string();
      return decoded === undefined
        ? fail(start)
        : builder.string(decoded, start, position);
    }
    if (first === 91 || first === 123) {
      const array = first === 91,
        close = array ? 93 : 125;
      const arrayState = array ? builder.openArray(start) : undefined,
        objectState = array ? undefined : builder.openObject(start);
      position++;
      whitespace();
      if (source.charCodeAt(position) !== close) {
        while (true) {
          whitespace();
          let key = "";
          if (!array) {
            const decoded = string();
            if (decoded === undefined) return fail(start);
            key = decoded;
            whitespace();
            if (source.charCodeAt(position++) !== 58) return fail(start);
          }
          const child = value();
          if (!ok) return child;
          if (arrayState !== undefined) builder.element(arrayState, child);
          else if (objectState !== undefined)
            builder.entry(objectState, key, child);
          whitespace();
          if (source.charCodeAt(position) !== 44) break;
          position++;
        }
      }
      if (source.charCodeAt(position++) !== close) return fail(start);
      if (arrayState !== undefined)
        return builder.closeArray(arrayState, start, position);
      if (objectState === undefined) throw "JSON_CONTAINER_INVARIANT";
      return builder.closeObject(objectState, start, position);
    }
    if (
      first === 110 &&
      position + 4 <= length &&
      source.charCodeAt(position + 1) === 117 &&
      source.charCodeAt(position + 2) === 108 &&
      source.charCodeAt(position + 3) === 108
    ) {
      position += 4;
      return builder.null(start, position);
    }
    if (
      first === 116 &&
      position + 4 <= length &&
      source.charCodeAt(position + 1) === 114 &&
      source.charCodeAt(position + 2) === 117 &&
      source.charCodeAt(position + 3) === 101
    ) {
      position += 4;
      return builder.boolean(true, start, position);
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
      return builder.boolean(false, start, position);
    }
    const negative = first === 45;
    if (negative) position++;
    let intValue = 0;
    let intDigits = 0;
    const head = source.charCodeAt(position);
    if (head === 48) {
      position++;
      intDigits = 1;
    } else {
      if (head < 48 || head > 57) return fail(start);
      intValue = head - 48;
      intDigits = 1;
      position++;
      while (position < length) {
        const c = source.charCodeAt(position);
        if (c < 48 || c > 57) break;
        if (intDigits < 15) intValue = intValue * 10 + (c - 48);
        intDigits++;
        position++;
      }
    }
    let isFloat = false;
    if (source.charCodeAt(position) === 46) {
      isFloat = true;
      position++;
      if (!digit()) return fail(start);
      while (digit()) position++;
    }
    const exponent = source.charCodeAt(position);
    if (exponent === 101 || exponent === 69) {
      isFloat = true;
      position++;
      const sign = source.charCodeAt(position);
      if (sign === 43 || sign === 45) position++;
      if (!digit()) return fail(start);
      while (digit()) position++;
    }
    if (directNumber !== undefined) {
      if (!isFloat && intDigits <= 15) {
        return directNumber(negative ? -intValue : intValue, start, position);
      }
      return directNumber(
        Number(source.slice(start, position)),
        start,
        position,
      );
    }
    return builder.number(source.slice(start, position), start, position);
  }
  const result = value();
  whitespace();
  const complete = ok && position === length;
  return {
    value: complete ? result : undefined,
    ok: complete,
    offset: Math.min(position, length),
  };
}

const nodeBuilder: JSONBuilder<JSONNode, JSONNode[], JSONEntry[]> = {
  null: (start, end) => ({ kind: "null", start, end }),
  boolean: (value, start, end) => ({ kind: "boolean", value, start, end }),
  number: (text, start, end) => ({ kind: "number", text, start, end }),
  string: (value, start, end) => ({ kind: "string", value, start, end }),
  openArray: (_start) => [],
  element: (elements, value) => {
    elements.push(value);
  },
  closeArray: (elements, start, end) => ({
    kind: "array",
    elements,
    start,
    end,
  }),
  openObject: (_start) => [],
  entry: (entries, key, value) => {
    entries.push({ key, value });
  },
  closeObject: (entries, start, end) => ({
    kind: "object",
    entries,
    start,
    end,
  }),
};

/** No host parsing/evaluation, coercion, or runtime objects; malformed input returns no tree. */
export function parseJSONText(source: string): JSONParseResult {
  const result = parseJSONWith<JSONNode, JSONNode[], JSONEntry[]>(
    source,
    nodeBuilder,
  );
  return { node: result.ok ? result.value : undefined, offset: result.offset };
}
