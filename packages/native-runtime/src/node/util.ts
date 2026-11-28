import { codedError, invalidArgument } from "./coded-errors.ts";
import { deepCompare } from "./value-comparison.ts";
import { format, formatWithOptions, inspect } from "./util-inspect.ts";
import { parseArgs, parseEnv } from "./util-args.ts";
import {
  aborted,
  callbackify,
  markPromiseAsHandled,
  promisify,
} from "./util-promise.ts";
import { MIMEParams, MIMEType } from "./util-mime.ts";

export {
  aborted,
  callbackify,
  format,
  formatWithOptions,
  inspect,
  markPromiseAsHandled,
  MIMEParams,
  MIMEType,
  parseArgs,
  parseEnv,
  promisify,
};
const Encoder = TextEncoder;
const Decoder = TextDecoder;
export { Encoder as TextEncoder, Decoder as TextDecoder };

interface DeepOptions {
  readonly skipPrototype?: boolean;
}
export function isDeepStrictEqual(
  actual: unknown,
  expected: unknown,
  options?: boolean | DeepOptions,
): boolean {
  return deepCompare(
    actual,
    expected,
    "strict",
    typeof options === "boolean" ? options : options?.skipPrototype === true,
  );
}
export function isPartialDeepStrictEqual(
  actual: unknown,
  expected: unknown,
): boolean {
  return deepCompare(actual, expected, "partial");
}
export function toUSVString(value: unknown): string {
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  return String(value).toWellFormed();
}

export function inherits(
  constructor: Function,
  superConstructor: Function,
): void {
  if (typeof constructor !== "function")
    throw invalidArgument("ctor", "of type function", constructor);
  if (typeof superConstructor !== "function")
    throw invalidArgument("superCtor", "of type function", superConstructor);
  const prototype: unknown = Reflect.get(superConstructor, "prototype");
  const child: unknown = Reflect.get(constructor, "prototype");
  if (typeof prototype !== "object" || prototype === null)
    throw invalidArgument("superCtor.prototype", "of type object", prototype);
  if (typeof child !== "object" || child === null)
    throw invalidArgument("ctor.prototype", "of type object", child);
  Object.defineProperty(constructor, "super_", {
    value: superConstructor,
    writable: true,
    configurable: true,
  });
  Object.setPrototypeOf(child, prototype);
}

const tag = Object.prototype.toString;
function tagged(value: unknown, name: string): boolean {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    tag.call(value) === "[object " + name + "]"
  );
}
const typedArrayNames = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];
function isTypedArray(value: unknown): boolean {
  return ArrayBuffer.isView(value) && !tagged(value, "DataView");
}
export const types = {
  isAnyArrayBuffer: (value: unknown): boolean =>
    tagged(value, "ArrayBuffer") || tagged(value, "SharedArrayBuffer"),
  isArrayBuffer: (value: unknown): boolean => tagged(value, "ArrayBuffer"),
  isSharedArrayBuffer: (value: unknown): boolean =>
    tagged(value, "SharedArrayBuffer"),
  isArrayBufferView: ArrayBuffer.isView,
  isArgumentsObject: (value: unknown): boolean => tagged(value, "Arguments"),
  isAsyncFunction: (value: unknown): boolean =>
    typeof value === "function" && tagged(value, "AsyncFunction"),
  isBigIntObject: (value: unknown): boolean => tagged(value, "BigInt"),
  isBooleanObject: (value: unknown): boolean => tagged(value, "Boolean"),
  isBoxedPrimitive(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      [
        "[object BigInt]",
        "[object Boolean]",
        "[object Number]",
        "[object String]",
        "[object Symbol]",
      ].includes(tag.call(value))
    );
  },
  isDataView: (value: unknown): boolean =>
    ArrayBuffer.isView(value) && tagged(value, "DataView"),
  isDate: (value: unknown): boolean => tagged(value, "Date"),
  isGeneratorFunction: (value: unknown): boolean =>
    typeof value === "function" &&
    (tagged(value, "GeneratorFunction") ||
      tagged(value, "AsyncGeneratorFunction")),
  isGeneratorObject: (value: unknown): boolean =>
    tagged(value, "Generator") || tagged(value, "AsyncGenerator"),
  isMap: (value: unknown): boolean => tagged(value, "Map"),
  isMapIterator: (value: unknown): boolean => tagged(value, "Map Iterator"),
  isModuleNamespaceObject: (value: unknown): boolean => tagged(value, "Module"),
  isNativeError: (value: unknown): boolean => value instanceof Error,
  isNumberObject: (value: unknown): boolean => tagged(value, "Number"),
  isPromise: (value: unknown): boolean => tagged(value, "Promise"),
  isRegExp: (value: unknown): boolean => tagged(value, "RegExp"),
  isSet: (value: unknown): boolean => tagged(value, "Set"),
  isSetIterator: (value: unknown): boolean => tagged(value, "Set Iterator"),
  isStringObject: (value: unknown): boolean => tagged(value, "String"),
  isSymbolObject: (value: unknown): boolean => tagged(value, "Symbol"),
  isTypedArray,
  isWeakMap: (value: unknown): boolean => tagged(value, "WeakMap"),
  isWeakSet: (value: unknown): boolean => tagged(value, "WeakSet"),
};
for (const name of typedArrayNames) {
  if (name === undefined) continue;
  Object.defineProperty(types, "is" + name, {
    value: (value: unknown): boolean =>
      isTypedArray(value) && tagged(value, name),
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export const isArray = Array.isArray;

export function stripVTControlCharacters(value: string): string {
  if (typeof value !== "string")
    throw invalidArgument("str", "of type string", value);
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    if (char !== 27 && char !== 155) {
      result += value.charAt(i);
      continue;
    }
    const next = value.charAt(i + 1);
    if (char === 155 || next === "[") {
      let end = i + (char === 155 ? 1 : 2);
      while (
        end < value.length &&
        value.charCodeAt(end) >= 32 &&
        value.charCodeAt(end) <= 63
      )
        end++;
      if (value.charCodeAt(end) >= 64 && value.charCodeAt(end) <= 126) {
        i = end;
        continue;
      }
    } else if (next === "]") {
      let end = i + 2;
      while (
        end < value.length &&
        value.charCodeAt(end) !== 7 &&
        value.charCodeAt(end) !== 156 &&
        value.slice(end, end + 2) !== "\u001b\\"
      )
        end++;
      if (end < value.length) {
        i = end + (value.charCodeAt(end) === 27 ? 1 : 0);
        continue;
      }
    } else if (
      next.length !== 0 &&
      next.charCodeAt(0) >= 64 &&
      next.charCodeAt(0) <= 95
    ) {
      i++;
      continue;
    }
    result += value.charAt(i);
  }
  return result;
}

const terminalStyles: Record<string, readonly number[] | undefined> = {
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  blink: [5, 25],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],
  doubleunderline: [21, 24],
  overlined: [53, 55],
};
const colorNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];
for (let i = 0; i < colorNames.length; i++) {
  const name = colorNames[i];
  if (name === undefined) continue;
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  terminalStyles[name] = [30 + i, 39];
  terminalStyles[name + "Bright"] = [90 + i, 39];
  terminalStyles["bg" + title] = [40 + i, 49];
  terminalStyles["bg" + title + "Bright"] = [100 + i, 49];
}
terminalStyles.gray = terminalStyles.blackBright;
terminalStyles.grey = terminalStyles.blackBright;
terminalStyles.bgGray = terminalStyles.bgBlackBright;
terminalStyles.bgGrey = terminalStyles.bgBlackBright;

interface StyleOptions {
  readonly validateStream?: boolean;
  readonly stream?: {
    readonly isTTY?: boolean;
    readonly hasColors?: () => boolean;
  };
}
export function styleText(
  format: string | readonly string[],
  text: string,
  options?: StyleOptions,
): string {
  if (typeof text !== "string")
    throw invalidArgument("text", "of type string", text);
  const names = typeof format === "string" ? [format] : format;
  if (!Array.isArray(names))
    throw invalidArgument(
      "format",
      "of type string or an instance of Array",
      format,
    );
  let open = "",
    close = "";
  for (const name of names) {
    const style =
      typeof name === "string" && Object.hasOwn(terminalStyles, name)
        ? terminalStyles[name]
        : undefined;
    if (style === undefined)
      throw codedError(
        new TypeError("Unknown terminal style: " + String(name)),
        "ERR_INVALID_ARG_VALUE",
      );
    open += "\u001b[" + style[0] + "m";
    close = "\u001b[" + style[1] + "m" + close;
  }
  if (
    options?.validateStream !== false &&
    !(options?.stream?.isTTY === true && options.stream.hasColors?.() !== false)
  )
    return text;
  return open + text + close;
}

export default {
  aborted,
  callbackify,
  format,
  formatWithOptions,
  inspect,
  inherits,
  isArray,
  isDeepStrictEqual,
  isPartialDeepStrictEqual,
  markPromiseAsHandled,
  MIMEParams,
  MIMEType,
  parseArgs,
  parseEnv,
  promisify,
  stripVTControlCharacters,
  styleText,
  TextEncoder: Encoder,
  TextDecoder: Decoder,
  toUSVString,
  types,
};
