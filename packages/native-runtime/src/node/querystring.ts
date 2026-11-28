import { Buffer } from "node:buffer";

interface ParseOptions {
  readonly maxKeys?: number;
  readonly decodeURIComponent?: (value: string) => string;
}
interface StringifyOptions {
  readonly encodeURIComponent?: (value: string) => string;
}
type QueryValue = string | string[];
type ParsedQuery = Record<string, QueryValue | undefined>;

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

export function unescapeBuffer(
  input: string,
  decodeSpaces: boolean = false,
): Buffer {
  const output = new Uint8Array(input.length);
  let written = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code === 37) {
      const high = hexDigit(input.charCodeAt(index + 1));
      const low = hexDigit(input.charCodeAt(index + 2));
      if (high >= 0 && low >= 0) {
        output[written++] = high * 16 + low;
        index += 2;
        continue;
      }
    }
    output[written++] = code === 43 && decodeSpaces ? 32 : code;
  }
  return Buffer.from(output.subarray(0, written));
}
export function unescape(input: string, decodeSpaces: boolean = false): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return unescapeBuffer(input, decodeSpaces).toString("utf8");
  }
}
export function escape(input: unknown): string {
  if (typeof input === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  return encodeURIComponent(String(input));
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return String(value);
  return "";
}

export function stringify(
  input: unknown,
  separator?: string,
  equals?: string,
  options?: StringifyOptions,
): string {
  if (input === null || typeof input !== "object") return "";
  const sep = separator || "&",
    eq = equals || "=";
  const encode =
    typeof options?.encodeURIComponent === "function"
      ? options.encodeURIComponent
      : querystring.escape;
  const pairs: string[] = [];
  for (const key of Object.keys(input)) {
    if (key === undefined) continue;
    const value: unknown = Reflect.get(input, key);
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const prefix = encode(key) + eq;
      for (const item of value)
        pairs.push(prefix + encode(stringifyValue(item)));
    } else pairs.push(encode(key) + eq + encode(stringifyValue(value)));
  }
  return pairs.join(sep);
}

function decodePart(value: string, decode: (input: string) => string): string {
  try {
    return decode(value);
  } catch {
    return querystring.unescape(value, true);
  }
}

export function parse(
  input: string,
  separator?: string,
  equals?: string,
  options?: ParseOptions,
): ParsedQuery {
  const result: ParsedQuery = Object.create(null);
  if (typeof input !== "string" || input.length === 0) return result;
  const sep = String(separator || "&"),
    eq = String(equals || "=");
  const decode =
    typeof options?.decodeURIComponent === "function"
      ? options.decodeURIComponent
      : querystring.unescape;
  const custom = decode !== unescape;
  const plus = custom ? "%20" : " ";
  const configuredLimit = options?.maxKeys;
  let remaining =
    typeof configuredLimit !== "number"
      ? 1000
      : configuredLimit > 0 && Number.isInteger(configuredLimit)
        ? configuredLimit
        : Infinity;
  if (sep.length === 0) return result;

  let key = "",
    value = "",
    start = 0;
  let separatorPrefix = 0,
    equalsPrefix = 0;
  let keyEncoded = custom,
    valueEncoded = custom,
    escapeWidth = 0;

  function addPair(end: number): void {
    if (equalsPrefix < eq.length) {
      key += start < end ? input.slice(start, end) : "";
      if (key === "") return;
    } else if (start < end) value += input.slice(start, end);
    const name = keyEncoded && key.length > 0 ? decodePart(key, decode) : key;
    const item =
      valueEncoded && value.length > 0 ? decodePart(value, decode) : value;
    const previous = result[name];
    if (previous === undefined) result[name] = item;
    else if (typeof previous === "string") result[name] = [previous, item];
    else previous.push(item);
  }

  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    // A separator prefix takes precedence over the equals delimiter.
    if (char === sep.charAt(separatorPrefix)) {
      separatorPrefix++;
      if (separatorPrefix === sep.length) {
        addPair(index + 1 - separatorPrefix);
        if (--remaining === 0) return result;
        key = value = "";
        keyEncoded = valueEncoded = custom;
        start = index + 1;
        separatorPrefix = equalsPrefix = escapeWidth = 0;
      }
      continue;
    }
    separatorPrefix = 0;
    const inKey = equalsPrefix < eq.length;
    if (inKey) {
      if (char === eq.charAt(equalsPrefix)) {
        equalsPrefix++;
        if (equalsPrefix === eq.length) {
          key += input.slice(start, index + 1 - equalsPrefix);
          start = index + 1;
          escapeWidth = 0;
        }
        continue;
      }
      equalsPrefix = 0;
    }
    if (char === "+") {
      const part = input.slice(start, index) + plus;
      if (inKey) {
        key += part;
        escapeWidth = 0;
      } else value += part;
      start = index + 1;
    } else if (!(inKey ? keyEncoded : valueEncoded)) {
      if (char === "%") escapeWidth = 1;
      else if (escapeWidth !== 0) {
        escapeWidth = hexDigit(char.charCodeAt(0)) >= 0 ? escapeWidth + 1 : 0;
        if (escapeWidth === 3) {
          if (inKey) keyEncoded = true;
          else valueEncoded = true;
        }
      }
    }
  }
  addPair(input.length);
  return result;
}

export const encode = stringify;
export const decode = parse;
const querystring = {
  escape,
  unescape,
  unescapeBuffer,
  stringify,
  encode,
  parse,
  decode,
};
export default querystring;
