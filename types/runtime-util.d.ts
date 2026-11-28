type TintTextEncoder = TextEncoder;
type TintTextDecoder = TextDecoder;
type TintTextEncoderConstructor = typeof TextEncoder;
type TintTextDecoderConstructor = typeof TextDecoder;

declare module "node:util" {
  export type TextEncoder = TintTextEncoder;
  export type TextDecoder = TintTextDecoder;
  export const TextEncoder: TintTextEncoderConstructor;
  export const TextDecoder: TintTextDecoderConstructor;

  export interface InspectOptions {
    showHidden?: boolean;
    depth?: number | null;
    colors?: boolean;
    customInspect?: boolean;
    sorted?: boolean;
    getters?: boolean | "get" | "set";
    maxArrayLength?: number | null;
    maxStringLength?: number | null;
  }
  export interface Inspector {
    (value: unknown, options?: InspectOptions): string;
    (
      value: unknown,
      showHidden?: boolean,
      depth?: number | null,
      colors?: boolean,
    ): string;
    readonly custom: unique symbol;
    defaultOptions: InspectOptions;
  }
  export const inspect: Inspector;
  export function format(format?: unknown, ...args: unknown[]): string;
  export function formatWithOptions(
    options: InspectOptions,
    format?: unknown,
    ...args: unknown[]
  ): string;
  export function isDeepStrictEqual(
    actual: unknown,
    expected: unknown,
    options?: boolean | { skipPrototype?: boolean },
  ): boolean;
  export function isPartialDeepStrictEqual(
    actual: unknown,
    expected: unknown,
  ): boolean;
  export function toUSVString(value: unknown): string;
  export function stripVTControlCharacters(value: string): string;
  export function isArray(value: unknown): value is unknown[];
  export function inherits(
    constructor: Function,
    superConstructor: Function,
  ): void;

  export type ParseArgsOption =
    | {
        type: "boolean";
        short?: string;
        multiple?: boolean;
        default?: boolean | boolean[];
      }
    | {
        type: "string";
        short?: string;
        multiple?: boolean;
        default?: string | string[];
      };
  export interface ParseArgsConfig {
    args?: readonly string[];
    options?: Readonly<Record<string, ParseArgsOption>>;
    strict?: boolean;
    allowPositionals?: boolean;
    allowNegative?: boolean;
    tokens?: boolean;
  }
  export type ParseArgsToken =
    | {
        kind: "option";
        index: number;
        name: string;
        rawName: string;
        value: string | undefined;
        inlineValue: boolean | undefined;
      }
    | { kind: "positional"; index: number; value: string }
    | { kind: "option-terminator"; index: number };
  type OptionScalar<Option> = Option extends { type: "boolean" }
    ? boolean
    : string;
  type OptionValue<Option> = Option extends { multiple: true }
    ? OptionScalar<Option>[]
    : OptionScalar<Option>;
  type ParseValues<Config> = Config extends { options: infer Options }
    ? { [Key in keyof Options]: OptionValue<Options[Key]> | undefined }
    : Record<string, string | boolean | (string | boolean)[] | undefined>;
  export function parseArgs<
    const Config extends ParseArgsConfig = ParseArgsConfig,
  >(
    config?: Config,
  ): { values: ParseValues<Config>; positionals: string[] } & (Config extends {
    tokens: true;
  }
    ? { tokens: ParseArgsToken[] }
    : { tokens?: ParseArgsToken[] });
  export function parseEnv(value: string): Record<string, string>;

  export interface Promisify {
    <Args extends unknown[], Result>(
      fn: (...args: [...Args, (error: any, result: Result) => void]) => unknown,
    ): (...args: Args) => Promise<Result>;
    <Args extends unknown[]>(
      fn: (...args: [...Args, (error?: any) => void]) => unknown,
    ): (...args: Args) => Promise<void>;
    readonly custom: unique symbol;
  }
  export const promisify: Promisify;
  export function callbackify<Args extends unknown[], Result>(
    fn: (...args: Args) => PromiseLike<Result>,
  ): (
    ...args: [...Args, (error: Error | null, result?: Result) => void]
  ) => void;
  export function markPromiseAsHandled(promise: Promise<unknown>): void;
  export function aborted(signal: AbortSignal, resource: object): Promise<void>;

  export class MIMEParams implements Iterable<[string, string]> {
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
  }
  export class MIMEType {
    constructor(input: string);
    type: string;
    subtype: string;
    readonly essence: string;
    readonly params: MIMEParams;
    toString(): string;
    toJSON(): string;
    static parse(input: string): MIMEType | null;
  }

  interface TypePredicates {
    isAnyArrayBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer;
    isArrayBuffer(value: unknown): value is ArrayBuffer;
    isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer;
    isArrayBufferView(value: unknown): value is ArrayBufferView;
    isArgumentsObject(value: unknown): value is IArguments;
    isAsyncFunction(
      value: unknown,
    ): value is (...args: any[]) => Promise<unknown>;
    isBoxedPrimitive(value: unknown): value is object;
    isDate(value: unknown): value is Date;
    isDataView(value: unknown): value is DataView;
    isMap(value: unknown): value is Map<unknown, unknown>;
    isNativeError(value: unknown): value is Error;
    isPromise(value: unknown): value is Promise<unknown>;
    isRegExp(value: unknown): value is RegExp;
    isSet(value: unknown): value is Set<unknown>;
    isWeakMap(value: unknown): value is WeakMap<object, unknown>;
    isWeakSet(value: unknown): value is WeakSet<object>;
    isInt8Array(value: unknown): value is Int8Array;
    isUint8Array(value: unknown): value is Uint8Array;
    isUint8ClampedArray(value: unknown): value is Uint8ClampedArray;
    isInt16Array(value: unknown): value is Int16Array;
    isUint16Array(value: unknown): value is Uint16Array;
    isInt32Array(value: unknown): value is Int32Array;
    isUint32Array(value: unknown): value is Uint32Array;
    isFloat16Array(value: unknown): value is Float16Array;
    isFloat32Array(value: unknown): value is Float32Array;
    isFloat64Array(value: unknown): value is Float64Array;
    isBigInt64Array(value: unknown): value is BigInt64Array;
    isBigUint64Array(value: unknown): value is BigUint64Array;
    isTypedArray(value: unknown): value is Exclude<ArrayBufferView, DataView>;
  }
  type OtherPredicates =
    | "isBigIntObject"
    | "isBooleanObject"
    | "isGeneratorFunction"
    | "isGeneratorObject"
    | "isMapIterator"
    | "isModuleNamespaceObject"
    | "isNumberObject"
    | "isSetIterator"
    | "isStringObject"
    | "isSymbolObject";
  export const types: TypePredicates &
    Record<OtherPredicates, (value: unknown) => boolean>;
  export function styleText(
    style: string | readonly string[],
    value: string,
    options?: {
      validateStream?: boolean;
      stream?: { isTTY?: boolean; hasColors?(): boolean };
    },
  ): string;

  const util: {
    aborted: typeof aborted;
    callbackify: typeof callbackify;
    format: typeof format;
    formatWithOptions: typeof formatWithOptions;
    inherits: typeof inherits;
    inspect: typeof inspect;
    isArray: typeof isArray;
    isDeepStrictEqual: typeof isDeepStrictEqual;
    isPartialDeepStrictEqual: typeof isPartialDeepStrictEqual;
    markPromiseAsHandled: typeof markPromiseAsHandled;
    MIMEParams: typeof MIMEParams;
    MIMEType: typeof MIMEType;
    parseArgs: typeof parseArgs;
    parseEnv: typeof parseEnv;
    promisify: typeof promisify;
    stripVTControlCharacters: typeof stripVTControlCharacters;
    styleText: typeof styleText;
    TextEncoder: typeof TextEncoder;
    TextDecoder: typeof TextDecoder;
    toUSVString: typeof toUSVString;
    types: typeof types;
  };
  export default util;
}
