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

/** No host parsing/evaluation, coercion, or runtime objects; malformed input returns no tree. */
export function parseJSONText(source: string): JSONParseResult {
  let position = 0;
  function whitespace(): void {
    while (position < source.length) {
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
    if (source.charAt(position) !== '"') return undefined;
    position++;
    const parts: string[] = [];
    let start = position;
    while (position < source.length) {
      const unit = source.charCodeAt(position++);
      if (unit === 34) {
        parts.push(source.slice(start, position - 1));
        return parts.join("");
      }
      if (unit < 32) return undefined;
      if (unit !== 92) continue;
      parts.push(source.slice(start, position - 1));
      const escape = source.charAt(position++);
      if (escape === '"' || escape === "\\" || escape === "/")
        parts.push(escape);
      else if (escape === "b") parts.push("\b");
      else if (escape === "f") parts.push("\f");
      else if (escape === "n") parts.push("\n");
      else if (escape === "r") parts.push("\r");
      else if (escape === "t") parts.push("\t");
      else if (escape === "u") {
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
  function value(): JSONNode | undefined {
    whitespace();
    const start = position,
      first = source.charAt(position);
    if (first === '"') {
      const decoded = string();
      return decoded === undefined
        ? undefined
        : { kind: "string", value: decoded, start, end: position };
    }
    if (first === "[" || first === "{") {
      const array = first === "[",
        close = array ? "]" : "}";
      const elements: JSONNode[] = [],
        entries: JSONEntry[] = [];
      position++;
      whitespace();
      if (source.charAt(position) !== close) {
        while (true) {
          whitespace();
          let key = "";
          if (!array) {
            const decoded = string();
            if (decoded === undefined) return undefined;
            key = decoded;
            whitespace();
            if (source.charAt(position++) !== ":") return undefined;
          }
          const child = value();
          if (child === undefined) return undefined;
          if (array) elements.push(child);
          else entries.push({ key, value: child });
          whitespace();
          if (source.charAt(position) !== ",") break;
          position++;
        }
      }
      if (source.charAt(position++) !== close) return undefined;
      return array
        ? { kind: "array", elements, start, end: position }
        : { kind: "object", entries, start, end: position };
    }
    for (const literal of ["null", "true", "false"]) {
      if (literal === undefined) throw "JSON_LITERAL_INVARIANT";
      if (source.slice(position, position + literal.length) === literal) {
        position += literal.length;
        return literal === "null"
          ? { kind: "null", start, end: position }
          : {
              kind: "boolean",
              value: literal === "true",
              start,
              end: position,
            };
      }
    }
    if (first === "-") position++;
    if (source.charAt(position) === "0") position++;
    else {
      if (!digit()) return undefined;
      while (digit()) position++;
    }
    if (source.charAt(position) === ".") {
      position++;
      if (!digit()) return undefined;
      while (digit()) position++;
    }
    const exponent = source.charAt(position);
    if (exponent === "e" || exponent === "E") {
      position++;
      if (source.charAt(position) === "+" || source.charAt(position) === "-")
        position++;
      if (!digit()) return undefined;
      while (digit()) position++;
    }
    return {
      kind: "number",
      text: source.slice(start, position),
      start,
      end: position,
    };
  }
  const node = value();
  whitespace();
  return {
    node: position === source.length ? node : undefined,
    offset: Math.min(position, source.length),
  };
}
