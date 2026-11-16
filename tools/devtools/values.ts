// Language-neutral RemoteObjects for DAP variables: numbers, booleans and
// C strings as primitives, everything with children as an expandable
// object (arrays when the adapter reports indexed children).
import type { DapVariable, RemoteObject } from "./plugin.ts";

const integerType =
  /^(const |volatile )*((un)?signed |long |short )*(char|short|int|long|size_t|ssize_t|ptrdiff_t|u?int\d+_t|bool|_Bool)$/;
const floatType = /^(const |volatile )*(float|double|long double)$/;

export function numberObject(text: string): RemoteObject | undefined {
  const value = Number(text);
  if (text.trim() === "" || Number.isNaN(value)) {
    if (/^-?(inf|nan)$/i.test(text.trim())) {
      const special = text.trim().toLowerCase().startsWith("-")
        ? "-Infinity"
        : /nan/i.test(text)
          ? "NaN"
          : "Infinity";
      return {
        type: "number",
        unserializableValue: special,
        description: special,
      };
    }
    return undefined;
  }
  if (Object.is(value, -0))
    return { type: "number", unserializableValue: "-0", description: "-0" };
  return { type: "number", value, description: String(value) };
}

/** A double-quoted (C/JSON-escaped) string at the end of a value. */
export function quotedText(text: string): string | undefined {
  const match = /"((?:[^"\\]|\\.)*)"(\.\.\.)?$/.exec(text);
  if (match === null) return undefined;
  try {
    return (
      (JSON.parse('"' + (match[1] ?? "") + '"') as string) + (match[2] ?? "")
    );
  } catch {
    return match[1];
  }
}

export function unavailable(text: string): boolean {
  return /^<(error: )?(variable not available|optimized out|unavailable)/.test(
    text,
  );
}

export function genericRemoteObject(
  variable: DapVariable,
  objectId: string | undefined,
): RemoteObject {
  const type = variable.type ?? "";
  const value = variable.value;
  if (unavailable(value))
    return { type: "undefined", description: "<optimized out>" };
  if (type === "bool" || type === "_Bool") {
    if (value === "true" || value === "false")
      return { type: "boolean", value: value === "true" };
  }
  if (floatType.test(type) || (integerType.test(type) && !/char$/.test(type))) {
    const number = numberObject(value);
    if (number !== undefined) return number;
  }
  if (/char\s*(\*|\[)/.test(type)) {
    const text = quotedText(value);
    if (text !== undefined) return { type: "string", value: text };
  }
  if (variable.variablesReference > 0) {
    const indexed = variable.indexedVariables;
    return {
      type: "object",
      ...(indexed !== undefined ? { subtype: "array" } : {}),
      className: type || "Object",
      description:
        indexed !== undefined && !/\[\d+\]$/.test(type)
          ? (type || "Array") + "(" + indexed + ")"
          : value !== ""
            ? value
            : type,
      ...(objectId === undefined ? {} : { objectId }),
    };
  }
  if (/\*$/.test(type) && /^0x0+$/.test(value))
    return {
      type: "object",
      subtype: "null",
      value: null,
      description: "NULL",
    };
  const number = integerType.test(type) ? numberObject(value) : undefined;
  if (number !== undefined) return number;
  return { type: "object", className: type || "Object", description: value };
}

/** `[3]` -> `3`, `["key"]` -> `key`; other names unchanged. */
export function propertyNameOf(name: string): string {
  const index = /^\[(\d+)\]$/.exec(name);
  if (index !== null) return index[1] ?? name;
  const key = /^\["((?:[^"\\]|\\.)*)"\]$/.exec(name);
  if (key !== null) {
    try {
      return JSON.parse('"' + (key[1] ?? "") + '"') as string;
    } catch {
      return key[1] ?? name;
    }
  }
  return name;
}
