// Comprehensive language syntax, feature, and builtin benchmark registry.
// Declares every kernel, its taxonomy category, compilation mode, scales, and
// covered features so the runner, scorecard, and tests share one source of truth.

export type LanguageCategory =
  | "serialization-binary"
  | "classes-oop"
  | "math-builtins"
  | "string-builtins"
  | "control-flow-syntax"
  | "collections-objects"
  | "stdlib-builtins"
  | "async-promises";

export const LANGUAGE_CATEGORIES: readonly {
  readonly id: LanguageCategory;
  readonly label: string;
}[] = [
  { id: "serialization-binary", label: "Serialization & Binary Data" },
  { id: "classes-oop", label: "Classes & Modern OOP" },
  { id: "math-builtins", label: "Math Builtins" },
  { id: "string-builtins", label: "String Builtins & Templates" },
  { id: "control-flow-syntax", label: "Control Flow, Syntax & Functional" },
  { id: "collections-objects", label: "Collections & Objects" },
  { id: "stdlib-builtins", label: "Standard Builtins" },
  { id: "async-promises", label: "Async & Promises" },
];

export type KernelSuite = "typed" | "general" | "async";
export type TypedSupportStatus = "native" | "fallback";

export interface KernelSpec {
  readonly name: string;
  readonly category: LanguageCategory;
  readonly suite: KernelSuite;
  /** "native" means the typed form MUST compile with TINT_GENERAL_FALLBACK=0.
   * "fallback" means the feature currently lowers through Tint's general realm
   * path (tracking unified-pipeline graduation progress). */
  readonly typedStatus: TypedSupportStatus;
  /** True if the typed image requires SharedArrayBuffer host bindings. */
  readonly needsSharedBuffer?: boolean;
  /** True if general-path execution requires the full Test262 Script host
   * (createNativeBatchBuilder) because the hosted program realm does not yet
   * wire weakStorage, SharedArrayBuffer, or Atomics. */
  readonly requiresScriptHostInGeneral?: boolean;
  /** Full measurement scale (calibrated for ~10-40ms steady Node per iteration). */
  readonly scale: number;
  /** Quick/smoke measurement scale (calibrated for fast parity & quick scorecard). */
  readonly quickScale: number;
  readonly description: string;
  readonly features: readonly string[];
}

export const LANGUAGE_KERNELS: readonly KernelSpec[] = [
  // --- 1. Serialization & Binary Data ---
  {
    name: "jsonRoundtrip",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 2000,
    quickScale: 400,
    description:
      "JSON.stringify & JSON.parse on nested typed objects, arrays, numbers, space formatting, and array replacers",
    features: ["JSON.stringify", "JSON.parse", "as T enrollment"],
  },
  {
    name: "jsonEscapeStrings",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 8000,
    quickScale: 2000,
    description:
      "JSON.stringify & JSON.parse on strings heavy in escapes, control chars, and Unicode surrogates",
    features: ["JSON.stringify", "JSON.parse", "string escaping", "Unicode"],
  },
  {
    name: "dataViewEndian",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 12000,
    quickScale: 3000,
    description:
      "ArrayBuffer + DataView LE/BE reads & writes across Int8..Float64, Float16, BigInt64, BigUint64",
    features: ["ArrayBuffer", "DataView", "LE/BE", "Float16", "BigInt64"],
  },
  {
    name: "sharedArrayBufferViews",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    needsSharedBuffer: true,
    requiresScriptHostInGeneral: true,
    scale: 20000,
    quickScale: 5000,
    description:
      "SharedArrayBuffer aliased views via Uint8Array, Int32Array, Float64Array, BigInt64Array, and DataView",
    features: ["SharedArrayBuffer", "ArrayBufferLike", "DataView", "aliasing"],
  },
  {
    name: "bigintArithmetic",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 10000,
    quickScale: 2500,
    description:
      "BigInt 64-bit and multi-limb arithmetic (+, -, *, /, %, shifts, bitwise, comparisons)",
    features: ["BigInt", "multi-limb arithmetic", "bitwise"],
  },
  {
    name: "bigintParse",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 10000,
    quickScale: 2500,
    description:
      "BigInt(string) parsing across decimal, signed, whitespace-trimmed, hex, octal, and binary literals",
    features: ["BigInt(string)", "hex/octal/binary", "multi-limb parse"],
  },
  {
    name: "bigintTypedArrays",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 1200,
    quickScale: 300,
    description:
      "BigInt64Array and BigUint64Array element read/write accumulation loops",
    features: ["BigInt64Array", "BigUint64Array"],
  },
  {
    name: "float16Array",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    scale: 1500,
    quickScale: 400,
    description:
      "Float16Array stencil and dot-product reads/writes with Math.f16round",
    features: ["Float16Array", "Math.f16round"],
  },
  {
    name: "atomicsOps",
    category: "serialization-binary",
    suite: "typed",
    typedStatus: "native",
    needsSharedBuffer: true,
    requiresScriptHostInGeneral: true,
    scale: 30000,
    quickScale: 8000,
    description:
      "Atomics load/store/add/sub/and/or/xor/exchange/compareExchange over Uint32Array, Uint16Array, Uint8Array",
    features: [
      "Atomics.load",
      "Atomics.store",
      "Atomics.add",
      "Atomics.compareExchange",
      "SharedArrayBuffer",
    ],
  },

  // --- 2. Classes & Modern OOP ---
  {
    name: "privateFieldsMethods",
    category: "classes-oop",
    suite: "typed",
    typedStatus: "native",
    scale: 60000,
    quickScale: 15000,
    description:
      "Private fields (#x), private methods (#m), private accessors (get/set #p), and static private members",
    features: ["#field", "#method", "get #x", "set #x", "static #x"],
  },
  {
    name: "privateBrandChecks",
    category: "classes-oop",
    suite: "typed",
    typedStatus: "native",
    scale: 15000,
    quickScale: 4000,
    description:
      "Ergonomic #field in obj brand checks over heterogeneous unknown arrays",
    features: ["#x in obj", "brand checks", "unknown narrowing"],
  },
  {
    name: "staticBlocksExpressions",
    category: "classes-oop",
    suite: "typed",
    typedStatus: "native",
    scale: 40000,
    quickScale: 10000,
    description:
      "Static fields, static { ... } blocks, and named/anonymous class expressions with extends",
    features: ["static {}", "static fields", "class expressions"],
  },
  {
    name: "deepInheritanceSuper",
    category: "classes-oop",
    suite: "typed",
    typedStatus: "native",
    scale: 25000,
    quickScale: 6000,
    description:
      "Multi-level extends hierarchy (3 levels), super(...) constructor chains, and super.method() dispatch",
    features: ["multi-level extends", "super()", "super.method()", "override"],
  },
  {
    name: "classAccessorsInstanceof",
    category: "classes-oop",
    suite: "typed",
    typedStatus: "native",
    scale: 12000,
    quickScale: 3000,
    description:
      "Public class getters/setters and instanceof checks across a class hierarchy",
    features: ["get/set", "instanceof", "class hierarchy"],
  },

  // --- 3. Math Builtins ---
  {
    name: "mathTranscendental",
    category: "math-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 1000,
    quickScale: 300,
    description:
      "Math.sin, cos, tan, atan2, sqrt, cbrt, sinh, cosh, tanh over floating-point loops",
    features: ["Math.sin", "Math.cos", "Math.sqrt", "Math.cbrt", "Math.atan2"],
  },
  {
    name: "mathBitwiseRounding",
    category: "math-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 40000,
    quickScale: 10000,
    description:
      "Math.imul, clz32, fround, f16round, floor, ceil, round, trunc, abs, sign, min, max",
    features: ["Math.imul", "Math.clz32", "Math.fround", "Math.f16round"],
  },
  {
    name: "mathHypotPowLog",
    category: "math-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 25000,
    quickScale: 6000,
    description:
      "Math.pow, exp, expm1, log, log2, log10, log1p, and 2/3-argument Math.hypot",
    features: ["Math.pow", "Math.exp", "Math.log", "Math.hypot"],
  },

  // --- 4. String Builtins & Templates ---
  {
    name: "stringReplaceAll",
    category: "string-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 10000,
    quickScale: 2500,
    description:
      "String.prototype.replace and replaceAll including $&/$'/$` substitution patterns",
    features: ["String.prototype.replace", "String.prototype.replaceAll"],
  },
  {
    name: "stringNormalizeUnicode",
    category: "string-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 2500,
    quickScale: 600,
    description:
      "String.prototype.normalize (NFC/NFD/NFKC/NFKD, ASCII & Unicode) and isWellFormed/toWellFormed",
    features: ["String.prototype.normalize", "isWellFormed", "toWellFormed"],
  },
  {
    name: "stringCaseAsciiUnicode",
    category: "string-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 3000,
    quickScale: 800,
    description:
      "ASCII and full Unicode toLowerCase/toUpperCase (sharp s, Greek final sigma, astral pairs)",
    features: [
      "String.prototype.toLowerCase",
      "String.prototype.toUpperCase",
      "Unicode casing",
    ],
  },
  {
    name: "stringTrimPadSearch",
    category: "string-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 15000,
    quickScale: 4000,
    description:
      "trim/trimStart/trimEnd, padStart/padEnd, startsWith/endsWith/includes, split/slice, repeat",
    features: [
      "trim",
      "padStart",
      "padEnd",
      "startsWith",
      "endsWith",
      "includes",
      "repeat",
    ],
  },
  {
    name: "taggedTemplates",
    category: "string-builtins",
    suite: "general",
    typedStatus: "fallback",
    scale: 8000,
    quickScale: 2000,
    description:
      "Tagged template literals inspecting cooked strings, .raw arrays, and dynamic interpolations",
    features: ["tagged templates", "TemplateStringsArray.raw"],
  },

  // --- 5. Control Flow, Syntax & Functional ---
  {
    name: "destructuringPatterns",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 30000,
    quickScale: 8000,
    description:
      "Object/array/nested destructuring, defaults, rest bindings, parameter destructuring, and swaps",
    features: [
      "object destructuring",
      "array destructuring",
      "defaults",
      "rest",
    ],
  },
  {
    name: "spreadArrayObjectCall",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 20000,
    quickScale: 5000,
    description:
      "Array spread ([...a, ...b]), object spread ({...o, k: v}), and call spread (fn(...args))",
    features: ["array spread", "object spread", "call spread"],
  },
  {
    name: "switchDenseSparseString",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 60000,
    quickScale: 15000,
    description:
      "Dense integer switch, sparse integer switch, and 16-case string switch dispatch",
    features: ["dense switch", "sparse switch", "string switch"],
  },
  {
    name: "tryCatchNoThrow",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 80000,
    quickScale: 20000,
    description:
      "Non-throwing try/catch/finally hot path measuring exception-frame setup overhead",
    features: ["try/catch/finally", "non-throwing path"],
  },
  {
    name: "tryCatchThrowError",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 6000,
    quickScale: 1500,
    description:
      "Throwing and catching Error/TypeError/RangeError with instanceof checks and finally cleanup",
    features: ["throw", "try/catch/finally", "Error", "instanceof"],
  },
  {
    name: "optionalChainingNullish",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 40000,
    quickScale: 10000,
    description:
      "Optional chaining (?. / ?.[i] / ?.()), nullish coalescing (??), and logical assignment (??= / ||= / &&=)",
    features: ["?.", "?.[i]", "?.()", "??", "??=", "||=", "&&="],
  },
  {
    name: "defaultRestParams",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 30000,
    quickScale: 8000,
    description:
      "Default parameter expressions (dependent defaults) and typed rest parameters with spread calls",
    features: ["default params", "rest params", "spread args"],
  },
  {
    name: "nestedClosures",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 40000,
    quickScale: 10000,
    description:
      "3-4 level nested lexical closures with shared mutable captures across iterations",
    features: ["nested closures", "mutable captures"],
  },
  {
    name: "forOfCollections",
    category: "control-flow-syntax",
    suite: "typed",
    typedStatus: "native",
    scale: 15000,
    quickScale: 4000,
    description:
      "for..of iteration across number[], record[], Uint32Array, string, Map, and Set",
    features: [
      "for..of",
      "Map iteration",
      "Set iteration",
      "TypedArray for..of",
    ],
  },
  {
    name: "generatorsYield",
    category: "control-flow-syntax",
    suite: "general",
    typedStatus: "fallback",
    scale: 1200,
    quickScale: 300,
    description:
      "Generator functions (function*), yield, yield* delegation, and lazy generator pipelines",
    features: ["function*", "yield", "yield*"],
  },
  {
    name: "customIterators",
    category: "control-flow-syntax",
    suite: "general",
    typedStatus: "fallback",
    scale: 2000,
    quickScale: 500,
    description:
      "Custom [Symbol.iterator] objects with stateful next() and abrupt break return() close protocol",
    features: ["Symbol.iterator", "iterator protocol", "return() close"],
  },

  // --- 6. Collections & Objects ---
  {
    name: "mapSetDeleteRehash",
    category: "collections-objects",
    suite: "typed",
    typedStatus: "native",
    scale: 1000,
    quickScale: 300,
    description:
      "Map and Set churn with inserts, overwrites, deletes, rehashes, and for..of iteration",
    features: ["Map.delete", "Set.delete", "rehash", "iteration"],
  },
  {
    name: "mapSetBigIntKeys",
    category: "collections-objects",
    suite: "typed",
    typedStatus: "native",
    scale: 600,
    quickScale: 150,
    description:
      "Map<bigint, number> and Set<bigint> with SameValueZero multi-limb keys, delete, and iteration",
    features: ["Map<bigint, V>", "Set<bigint>", "SameValueZero"],
  },
  {
    name: "mapSetObjectKeys",
    category: "collections-objects",
    suite: "typed",
    typedStatus: "native",
    scale: 1500,
    quickScale: 400,
    description:
      "Map and Set keyed by object/record identity with hits, misses, deletes, and iteration",
    features: ["Map<object, V>", "Set<object>", "identity hashing"],
  },
  {
    name: "objectDynamicOps",
    category: "collections-objects",
    suite: "typed",
    typedStatus: "native",
    scale: 1500,
    quickScale: 400,
    description:
      "Dynamic Record<string, number> reads/writes, in, delete, for..in, Object.keys/values/entries/defineProperty",
    features: [
      "Record<string, T>",
      "Object.keys",
      "Object.values",
      "Object.entries",
      "Object.defineProperty",
      "for..in",
    ],
  },
  {
    name: "weakMapSet",
    category: "collections-objects",
    suite: "general",
    typedStatus: "fallback",
    requiresScriptHostInGeneral: true,
    scale: 2000,
    quickScale: 500,
    description:
      "WeakMap and WeakSet get/set/has/delete over live and transient JS objects",
    features: ["WeakMap", "WeakSet"],
  },
  {
    name: "objectAssignFromEntries",
    category: "collections-objects",
    suite: "general",
    typedStatus: "fallback",
    scale: 1500,
    quickScale: 400,
    description:
      "Object.assign, Object.fromEntries, Object.create, Object.getOwnPropertyNames, and Object.freeze",
    features: [
      "Object.assign",
      "Object.fromEntries",
      "Object.create",
      "Object.freeze",
    ],
  },
  {
    name: "arrayHofsFull",
    category: "collections-objects",
    suite: "general",
    typedStatus: "fallback",
    scale: 800,
    quickScale: 200,
    description:
      "Array.prototype map, filter, reduce, sort, flat, flatMap, find, some, every, slice, splice, concat",
    features: [
      "Array.prototype.reduce",
      "Array.prototype.flat",
      "Array.prototype.sort",
      "Array.prototype.splice",
    ],
  },

  // --- 7. Standard Builtins ---
  {
    name: "errorConstruction",
    category: "stdlib-builtins",
    suite: "typed",
    typedStatus: "native",
    scale: 3000,
    quickScale: 800,
    description:
      "Constructing Error, TypeError, RangeError instances, reading name/message, and instanceof checks",
    features: ["Error", "TypeError", "RangeError", "instanceof"],
  },
  {
    name: "regexpMatchExecReplace",
    category: "stdlib-builtins",
    suite: "general",
    typedStatus: "fallback",
    scale: 1000,
    quickScale: 250,
    description:
      "RegExp test, global exec with capture groups, String.prototype.match, and RegExp replace",
    features: ["RegExp.test", "RegExp.exec", "String.match", "String.replace"],
  },
  {
    name: "dateOperations",
    category: "stdlib-builtins",
    suite: "general",
    typedStatus: "fallback",
    scale: 1500,
    quickScale: 400,
    description:
      "Date construction, Date.UTC, Date.parse, UTC component getters, and toISOString",
    features: ["Date", "Date.UTC", "Date.parse", "Date.prototype.toISOString"],
  },
  {
    name: "symbolKeysRegistry",
    category: "stdlib-builtins",
    suite: "general",
    typedStatus: "fallback",
    scale: 2500,
    quickScale: 600,
    description:
      "Symbol(), Symbol.for/keyFor registry, symbol-keyed object properties, and Symbol.toPrimitive",
    features: ["Symbol", "Symbol.for", "Symbol.keyFor", "Symbol.toPrimitive"],
  },
  {
    name: "proxyReflect",
    category: "stdlib-builtins",
    suite: "general",
    typedStatus: "fallback",
    scale: 2000,
    quickScale: 500,
    description:
      "Proxy get/set/has/apply traps paired with Reflect.get/set/has/apply/construct",
    features: ["Proxy", "Reflect.get", "Reflect.set", "Reflect.apply"],
  },

  // --- 8. Async & Promises ---
  {
    name: "promiseChains",
    category: "async-promises",
    suite: "async",
    typedStatus: "fallback",
    scale: 2000,
    quickScale: 500,
    description:
      "Promise.resolve and chained .then/.catch microtask resolution throughput",
    features: ["Promise.resolve", "Promise.prototype.then", "microtasks"],
  },
  {
    name: "promiseAllBatch",
    category: "async-promises",
    suite: "async",
    typedStatus: "fallback",
    scale: 600,
    quickScale: 150,
    description:
      "Promise.all, Promise.allSettled, and Promise.race over microtask promise batches",
    features: ["Promise.all", "Promise.allSettled", "Promise.race"],
  },
  {
    name: "asyncAwaitMicrotasks",
    category: "async-promises",
    suite: "async",
    typedStatus: "fallback",
    scale: 2000,
    quickScale: 500,
    description:
      "async/await sequential chains, helper calls, and try/catch rejection handling",
    features: ["async", "await", "try/catch rejection"],
  },
];

export function kernelsBySuite(suite: KernelSuite): readonly KernelSpec[] {
  return LANGUAGE_KERNELS.filter((kernel) => kernel.suite === suite);
}

export function kernelByName(name: string): KernelSpec | undefined {
  return LANGUAGE_KERNELS.find((kernel) => kernel.name === name);
}
