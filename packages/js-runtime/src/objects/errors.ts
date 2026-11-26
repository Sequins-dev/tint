import type { RealmReferrer } from "../modules/referrer.ts";
import {
  createIntrinsicFunctions,
  type IntrinsicFunctions,
} from "./intrinsic-functions.ts";
import type { ByteAllocator } from "../bytes/index.ts";
import type { ModuleLoader } from "../modules/loading.ts";
import { installModuleSourceIntrinsic } from "./module-source.ts";
import type { NamedTimeZoneProvider } from "./named-time-zones.ts";
import {
  createRegExpLegacyState,
  type RegExpLegacyState,
} from "./regexp-legacy-state.ts";
import { getFunctionRealm } from "./function-realms.ts";
import type { PromiseRecord } from "../promises/index.ts";
import { getScriptIterator, collectScriptIterator } from "./iteration.ts";
import {
  activeExecutionNames,
  createScriptAgent,
  runScriptContext,
  type ScriptAgent,
} from "./jobs.ts";
import { installAsyncFromSyncIntrinsics } from "./async-iteration.ts";
import { installAsyncGeneratorIntrinsics } from "./async-generators.ts";
import { installGeneratorIntrinsics } from "./generators.ts";
import { installIteratorIntrinsics } from "./iterator-intrinsics.ts";
import {
  createSymbolRegistry,
  createSymbolValue,
  viewSymbolValue,
  type SymbolRegistry,
  type SymbolValue,
} from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  ensureArrayChildShape,
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createCallableObject,
  createConstructorObject,
  getProperty,
  getOwnProperty,
  createDataProperty,
  setProperty,
  hasProperty,
  preventExtensions,
  markPrototype,
  makePrototypeImmutable,
  defineOwnProperty,
  propertyEpoch,
  type OrdinaryObject,
  type OrdinaryPropertyShape,
  type ObjectHooks,
  type ObjectInternalMethods,
  type ObjectExecutionContext,
} from "./operations.ts";
import { viewObjectValue, viewTypeofObject } from "./values.ts";
import { instanceOfValue } from "./functions.ts";
import { viewBigIntValue } from "./bigints.ts";
import { createArrayObject, type ArrayObjectHooks } from "./arrays.ts";
import { scriptPropertyKeyOrder } from "./symbols.ts";
import { stringValue, numberValue } from "./coercion.ts";
import {
  builtinFunctionMetadata,
  builtinProperty,
  builtinFunction,
  builtinAccessor,
} from "./intrinsics.ts";
import { installObjectPrototype } from "./object-prototype.ts";
import { createPrimitiveObject } from "./boxed-primitives.ts";
import type { TemplateCacheEntry } from "./templates.ts";
import {
  getField,
  setField,
  enumerableField,
  configurableField,
} from "../descriptors/index.ts";

/** Embedding-owned indirect PerformEval; the source is already a String. */
export type EvalCompiler = (source: string) => unknown;
/** Caller facts and site stay opaque to the realm's dispatch layer. */
export type DirectEvalCompiler = (
  source: string,
  flags: number,
  site: unknown,
) => unknown;
/** Compiler-owned source boundary. Inputs have already undergone ToString.
 * The compiler validates syntax/bindings before prototype lookup, creates the
 * function in this realm's global environment, or reports unsupported execution.
 * JavaScript properties cannot replace this embedding-owned callback. */
export type DynamicFunctionCompiler = (
  kind: "normal" | "generator" | "async" | "async-generator",
  parameters: readonly string[],
  body: string,
  newTarget: unknown,
) => OrdinaryObject<ScriptPropertyKey, unknown>;

/** Realm-local intrinsic identities and sticky embedding diagnostics. */
export interface ErrorRealm {
  readonly objectHooks: ObjectHooks<unknown>;
  readonly shadowRealmPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  abstractModuleSourceConstructor:
    OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly abstractModuleSourcePrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  moduleLoader: ModuleLoader | undefined;
  realmReferrer: RealmReferrer | undefined;
  readonly supportedImportAttributes: readonly string[];
  /** The realm-owned %eval% identity; ordinary global writes cannot replace it. */
  evalFunction: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** %Function.prototype.apply%, which forwarding call sites compare. */
  functionApply: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** %Function.prototype.call%, which forwarding call sites compare. */
  functionCall: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** Private sentinel returned by scriptArrayPop when the fast path misses. */
  readonly arrayPopMiss: OrdinaryObject<ScriptPropertyKey, unknown>;
  evalCompiler: EvalCompiler | undefined;
  directEvalCompiler: DirectEvalCompiler | undefined;
  dynamicFunctionCompiler: DynamicFunctionCompiler | undefined;
  namedTimeZones: NamedTimeZoneProvider | undefined;
  /** Stable, sorted primary-name inventory supplied by the database adapter. */
  availableTimeZoneIdentifiers: (() => readonly string[]) | undefined;
  /** Embedding wall clock, independent of the monotonic benchmark capability. */
  wallClockMilliseconds: (() => number) | undefined;
  /** Host-owned identifier, independent of transition bytes and user-visible methods. */
  systemTimeZoneIdentifier: (() => string) | undefined;
  localTimeOffsetSeconds: ((epochSeconds: number) => number) | undefined;
  localTimeToUTC: ((localMilliseconds: number) => number) | undefined;
  readonly asyncDisposableStackPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly disposableStackPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly datePrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly temporalInstantPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly localePrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly collatorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly listFormatPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly segmenterPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly segmentsPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly segmentIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly pluralRulesPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly relativeTimeFormatPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly durationFormatPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly displayNamesPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly dateTimeFormatPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly numberFormatPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly temporalPlainTimePrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalZonedDateTimePrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalPlainYearMonthPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalPlainMonthDayPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalPlainDateTimePrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalDurationPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly temporalPlainDatePrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  bufferMaxBytes: number;
  bufferAllocator: ByteAllocator | undefined;
  readonly typedArrayPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly typedArrayPrototypes: Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >;
  typedArrayIntegerIndexed:
    | {
        readonly hooks: ObjectHooks<unknown>;
        readonly methods: ObjectInternalMethods<ScriptPropertyKey, unknown>;
      }
    | undefined;
  readonly dataViewPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly arrayBufferPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly sharedArrayBufferPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  /** Undefined selects the engine's input-proportional default work allowance. */
  regexpMaxSteps: number | undefined;
  readonly regexpLegacyState: RegExpLegacyState;
  readonly regexpPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  /** Embedding resource limit in base-2^26 digits; defaults to the representation limit. */
  bigIntMaxDigits: number;
  readonly asyncFromSyncIteratorPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly asyncGeneratorFunctionPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly asyncGeneratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly asyncIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly asyncFunctionPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  promiseRejectionTracker: (
    promise: PromiseRecord<unknown>,
    operation: "reject" | "handle",
  ) => void;
  arrayConstructor: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly promisePrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  promiseConstructor: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly agent: ScriptAgent;
  readonly executionContext: ObjectExecutionContext<unknown>;
  readonly generatorFunctionPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly generatorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly setPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly setIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly mapPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly weakMapPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly weakSetPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly weakRefPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly finalizationRegistryPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly mapIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly iteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly regexpStringIteratorPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  readonly arrayIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly stringIteratorPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  arrayValues: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** Builtins generated calls may perform inline (see intrinsic-functions.ts). */
  readonly intrinsicFunctions: IntrinsicFunctions;
  readonly symbolRegistry: SymbolRegistry;
  readonly intlFallbackSymbol: SymbolValue;
  readonly symbolPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly bigIntPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly templateObjects: TemplateCacheEntry[];
  readonly numberPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly booleanPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly stringPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly arrayPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly arrayHooks: ArrayObjectHooks<ScriptPropertyKey, unknown>;
  /** Pre-initialized empty shape for dense arrays inheriting from arrayPrototype. */
  readonly arrayChildShape: OrdinaryPropertyShape<ScriptPropertyKey, unknown>;
  /** Pre-initialized exotic methods shared by arrays in this realm. */
  readonly arrayMethods: ObjectInternalMethods<ScriptPropertyKey, unknown>;
  /** Last propertyEpoch at which arrayPrototype/objectPrototype satisfied the
   * fast packed-append prototype-chain invariant (-1 when unverified). */
  cleanArrayPushEpoch: number;
  /** Shared property structure epoch cell, exposed on the realm so inlineable
   * fast helpers can validate epochs without capturing module globals. */
  readonly propertyEpoch: { value: number };
  readonly throwTypeError: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly functionPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  ordinaryHasInstanceMethod: unknown;
  readonly objectPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  /** Sticky embedding diagnostic; reset only at the start of a new host job. */
  unsupported: boolean;
  readonly prototypes: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>;
  readonly constructors: Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >;
}

function isAsciiIdentifierPart(code: number, start: boolean): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    code === 36 ||
    code === 95 ||
    (!start && code >= 48 && code <= 57)
  );
}

/** Conservative IdentifierName test (ASCII only; anything else is quoted). */
function isPlainIdentifierName(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++)
    if (!isAsciiIdentifierPart(text.charCodeAt(i), i === 0)) return false;
  return true;
}

/** `[Symbol.name]`, the form initial names take for well-known symbol keys. */
function isSymbolPropertyName(text: string): boolean {
  const last = text.length - 1;
  if (last < 2 || text.charCodeAt(0) !== 91 || text.charCodeAt(last) !== 93)
    return false;
  // Dot-separated IdentifierNames between the brackets.
  let segmentStart = true;
  for (let i = 1; i < last; i++) {
    const code = text.charCodeAt(i);
    if (code === 46) {
      if (segmentStart) return false;
      segmentStart = true;
    } else if (isAsciiIdentifierPart(code, segmentStart)) segmentStart = false;
    else return false;
  }
  return !segmentStart;
}

function stringLiteral(text: string): string {
  let result = '"';
  for (let i = 0; i < text.length; i++) {
    const char = text.slice(i, i + 1);
    const code = text.charCodeAt(i);
    if (char === '"' || char === "\\") result += "\\" + char;
    else if (code === 10) result += "\\n";
    else if (code === 13) result += "\\r";
    else if (code === 0x2028) result += "\\u2028";
    else if (code === 0x2029) result += "\\u2029";
    else result += char;
  }
  return result + '"';
}

/** The NativeFunctionAccessor_opt PropertyName_opt part of a built-in's
 * Function.prototype.toString result. The result must be NativeFunction syntax
 * (ECMA-262 20.2.3.5), so a property name that is not an IdentifierName or a
 * well-known symbol key (Annex B's `get $&`, for example) is written as a
 * computed string-literal name. */
function nativeFunctionName(initialName: string): string {
  const accessor =
    initialName.startsWith("get ") || initialName.startsWith("set ")
      ? initialName.slice(0, 4)
      : "";
  const name = initialName.slice(accessor.length);
  return name === "" ||
    isPlainIdentifierName(name) ||
    isSymbolPropertyName(name)
    ? initialName
    : accessor + "[" + stringLiteral(name) + "]";
}

export function createErrorRealm(
  objectPrototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  hooks: ObjectHooks<unknown>,
  symbolRegistry: SymbolRegistry = createSymbolRegistry(),
  agent: ScriptAgent = createScriptAgent(),
  supportedImportAttributes: readonly string[] = [],
): ErrorRealm {
  makePrototypeImmutable<ScriptPropertyKey, unknown>(objectPrototype);
  const prototypes = new Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >();
  function prototype(
    name: string,
    parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    builtinProperty(object, "name", name, true, true, hooks);
    builtinProperty(object, "message", "", true, true, hooks);
    return object;
  }
  const error = prototype("Error", objectPrototype);
  prototypes.set("error", error);
  const typePrototype = prototype("TypeError", error);
  prototypes.set("type", typePrototype);
  prototypes.set("reference", prototype("ReferenceError", error));
  prototypes.set("syntax", prototype("SyntaxError", error));
  prototypes.set("range", prototype("RangeError", error));
  prototypes.set("eval", prototype("EvalError", error));
  prototypes.set("uri", prototype("URIError", error));
  prototypes.set("aggregate", prototype("AggregateError", error));
  prototypes.set("suppressed", prototype("SuppressedError", error));
  const executionContext: ObjectExecutionContext<unknown> = {
    getRealm: (): ErrorRealm => realm,
    // Built-ins keep the caller's Script or module: a caller in this realm
    // already has that context record.
    run: (action): unknown => {
      const active = agent.activeContext;
      return runScriptContext<unknown>(
        agent,
        active !== undefined && active.realm === realm
          ? active
          : {
              realm,
              scriptOrModule:
                active === undefined ? undefined : active.scriptOrModule,
            },
        action,
      );
    },
  };
  const functionPrototype = createCallableObject<ScriptPropertyKey, unknown>(
    objectPrototype,
    (receiver, args): unknown => undefined,
    executionContext,
  );
  builtinFunctionMetadata(functionPrototype, "", 0, hooks);
  const throwTypeError = createCallableObject<ScriptPropertyKey, unknown>(
    functionPrototype,
    (receiver, args): unknown => {
      throw errorFromPrototype(typePrototype, agent, "TypeError");
    },
  );
  ensureExoticSlots(throwTypeError).internalInitialName = "";
  builtinProperty(throwTypeError, "length", 0, false, false, hooks);
  builtinProperty(throwTypeError, "name", "", false, false, hooks);
  preventExtensions<ScriptPropertyKey, unknown>(throwTypeError);
  for (const name of ["caller", "arguments"]) {
    if (name === undefined) throw "RESTRICTED_FUNCTION_KEY_INVARIANT";
    if (
      defineOwnProperty<ScriptPropertyKey, unknown>(
        functionPrototype,
        name,
        {
          fields: getField | setField | enumerableField | configurableField,
          value: undefined,
          writable: false,
          get: throwTypeError,
          set: throwTypeError,
          enumerable: false,
          configurable: true,
        },
        hooks,
      ) !== "accepted"
    )
      throw "RESTRICTED_FUNCTION_PROPERTY_INVARIANT";
  }
  // Exotic array methods execute in their caller's context. The array's home
  // realm only supplies a fallback when an embedding calls without a context.
  function activeArrayRealm(): ErrorRealm {
    const context = realm.agent.activeContext;
    return context === undefined ? realm : context.realm;
  }
  const arrayHooks: ArrayObjectHooks<ScriptPropertyKey, unknown> = {
    lengthKey: "length",
    index: (key): number => scriptPropertyKeyOrder(key),
    indexKey: (index): ScriptPropertyKey => String(index),
    numberPayload: (value): number | undefined =>
      typeof value === "number" ? value : undefined,
    fromNumber: (value): unknown => value,
    fromGeneral: (value): unknown => value,
    toNumber: (value): number => {
      const current = activeArrayRealm();
      const result = numberValue(value, hooks, current);
      if (result.error === "unsupported") rejectUnsupportedExecution(current);
      if (result.error === "type") throw createRuntimeError(current, "type");
      return result.value;
    },
    rangeError: (): unknown => createRuntimeError(activeArrayRealm(), "range"),
    internalMethods: undefined,
  };
  const arrayPrototype = createArrayObject<ScriptPropertyKey, unknown>(
    0,
    objectPrototype,
    arrayHooks,
    hooks,
  );
  markPrototype<ScriptPropertyKey, unknown>(arrayPrototype);
  const arrayChildShape = ensureArrayChildShape(arrayPrototype);
  const arrayMethods = arrayHooks.internalMethods;
  if (arrayMethods === undefined) throw "ARRAY_METHODS_INVARIANT";
  const iteratorPrototype = createObject<ScriptPropertyKey, unknown>(
    objectPrototype,
  );
  const asyncIteratorPrototype = createObject<ScriptPropertyKey, unknown>(
    objectPrototype,
  );
  const importAttributes: string[] = [];
  for (const attribute of supportedImportAttributes) {
    if (attribute === undefined) throw "IMPORT_ATTRIBUTE_POLICY_INVARIANT";
    importAttributes.push(attribute);
  }
  const realm: ErrorRealm = {
    objectHooks: hooks,
    shadowRealmPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    abstractModuleSourceConstructor: undefined,
    abstractModuleSourcePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    moduleLoader: undefined,
    realmReferrer: undefined,
    supportedImportAttributes: importAttributes,
    dynamicFunctionCompiler: undefined,
    evalFunction: undefined,
    functionApply: undefined,
    functionCall: undefined,
    arrayPopMiss: createObject<ScriptPropertyKey, unknown>(undefined),
    evalCompiler: undefined,
    directEvalCompiler: undefined,
    namedTimeZones: undefined,
    availableTimeZoneIdentifiers: undefined,
    wallClockMilliseconds: undefined,
    systemTimeZoneIdentifier: undefined,
    localTimeOffsetSeconds: undefined,
    localTimeToUTC: undefined,
    datePrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    temporalPlainYearMonthPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalPlainMonthDayPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalZonedDateTimePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalPlainTimePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    localePrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    durationFormatPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    displayNamesPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    dateTimeFormatPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    numberFormatPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    relativeTimeFormatPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    pluralRulesPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    collatorPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    listFormatPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    segmenterPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    segmentsPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    segmentIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    temporalInstantPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalPlainDateTimePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalDurationPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    disposableStackPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    asyncDisposableStackPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    temporalPlainDatePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    bigIntMaxDigits: 0xffffffff,
    asyncIteratorPrototype,
    asyncFromSyncIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      asyncIteratorPrototype,
    ),
    asyncGeneratorFunctionPrototype: createObject<ScriptPropertyKey, unknown>(
      functionPrototype,
    ),
    asyncGeneratorPrototype: createObject<ScriptPropertyKey, unknown>(
      asyncIteratorPrototype,
    ),
    asyncFunctionPrototype: createObject<ScriptPropertyKey, unknown>(
      functionPrototype,
    ),
    promiseRejectionTracker: (promise, operation): void => {},
    arrayConstructor: undefined,
    promisePrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    promiseConstructor: undefined,
    agent,
    executionContext,
    generatorFunctionPrototype: createObject<ScriptPropertyKey, unknown>(
      functionPrototype,
    ),
    iteratorPrototype,
    setPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    setIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    mapPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    weakMapPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    weakSetPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    weakRefPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    finalizationRegistryPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    mapIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    generatorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    regexpStringIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    arrayIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    stringIteratorPrototype: createObject<ScriptPropertyKey, unknown>(
      iteratorPrototype,
    ),
    arrayValues: undefined,
    intrinsicFunctions: createIntrinsicFunctions(),
    symbolRegistry,
    intlFallbackSymbol: createSymbolValue("IntlLegacyConstructedSymbol"),
    symbolPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    typedArrayPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    typedArrayPrototypes: new Map<
      string,
      OrdinaryObject<ScriptPropertyKey, unknown>
    >(),
    typedArrayIntegerIndexed: undefined,
    dataViewPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    // Implementation allocation cap per buffer (CreateByteDataBlock may throw
    // RangeError). 32 MiB covers every pinned Test262 allocation that must
    // succeed (staging/sm/extensions/dataview.js: 20 MiB).
    bufferMaxBytes: 33554432,
    bufferAllocator: undefined,
    arrayBufferPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    sharedArrayBufferPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    regexpMaxSteps: undefined,
    regexpLegacyState: createRegExpLegacyState(),
    regexpPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    bigIntPrototype: createObject<ScriptPropertyKey, unknown>(objectPrototype),
    templateObjects: [],
    numberPrototype: createPrimitiveObject("number", 0, objectPrototype, hooks),
    booleanPrototype: createPrimitiveObject(
      "boolean",
      false,
      objectPrototype,
      hooks,
    ),
    stringPrototype: createPrimitiveObject(
      "string",
      "",
      objectPrototype,
      hooks,
    ),
    arrayPrototype,
    arrayHooks,
    arrayChildShape,
    arrayMethods,
    cleanArrayPushEpoch: -1,
    propertyEpoch,
    throwTypeError,
    prototypes,
    constructors: new Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>(),
    objectPrototype,
    functionPrototype,
    ordinaryHasInstanceMethod: undefined,
    unsupported: false,
  };
  installObjectPrototype(realm, hooks);
  installModuleSourceIntrinsic(realm, hooks);
  installIteratorIntrinsics(realm, hooks);
  installGeneratorIntrinsics(realm, hooks);
  installAsyncGeneratorIntrinsics(realm, hooks);
  installAsyncFromSyncIntrinsics(realm, hooks);
  // Retain native initial names without reading user-overridable properties.
  // Source-defined functions use compiler-retained text when supplied.
  const functionString = builtinFunction(
    realm.functionPrototype,
    "toString",
    0,
    (receiver, args): unknown => {
      const fn = viewObjectValue(receiver, realm.objectPrototype);
      if (fn === undefined || fn.internalCall === undefined)
        throw createRuntimeError(realm, "type");
      const source = exoticSlots(fn).internalSourceText;
      if (source !== undefined) return source;
      const name = exoticSlots(fn).internalInitialName;
      if (name !== undefined)
        return "function " + nativeFunctionName(name) + "() { [native code] }";
      const rare = fn.internalRareSlots;
      if (
        (rare !== undefined && rare.internalBoundTarget !== undefined) ||
        exoticSlots(fn).internalProxyData !== undefined
      )
        return "function () { [native code] }";
      return rejectUnsupportedExecution(realm);
    },
    hooks,
  );
  builtinProperty(
    realm.functionPrototype,
    "toString",
    functionString,
    true,
    true,
    hooks,
  );
  // Array stringification requires join; do not inherit Object stringification.
  builtinProperty(
    arrayPrototype,
    "toString",
    builtinFunction(
      functionPrototype,
      "toString",
      0,
      (receiver, args): unknown => rejectUnsupportedExecution(realm),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  return realm;
}
/** Engine-created errors need no user coercion and no own message property. */
export function createRuntimeError(
  realm: ErrorRealm,
  kind: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const prototype = realm.prototypes.get(kind);
  if (prototype === undefined) throw "UNKNOWN_RUNTIME_ERROR_KIND";
  const constructor = realm.constructors.get(kind);
  return errorFromPrototype(
    prototype,
    realm.agent,
    (constructor === undefined
      ? undefined
      : exoticSlots(constructor).internalInitialName) ?? "Error",
  );
}

/** Dispatch through an adapter-supplied operation without reaching program
 * instance state from a retained helper. */
export function realmErrorOperation(
  value: unknown,
  operation: string,
): unknown {
  // Retained: it reads the exotic slot directly instead of calling
  // exoticSlots in another module.
  const object = viewTypeofObject(value);
  const exotic = object === undefined ? undefined : object.internalExoticSlots;
  const access =
    exotic === undefined ? undefined : exotic.internalTypedErrorAccess;
  return access === undefined ? undefined : access(operation);
}

function attachTypedErrorAccess(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  identity: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  function get(key: string): unknown {
    return getProperty<ScriptPropertyKey, unknown>(object, key, value, hooks);
  }
  ensureExoticSlots(object).internalTypedErrorAccess = (
    operation: string,
  ): unknown => {
    if (operation.startsWith("has:"))
      return hasProperty<ScriptPropertyKey, unknown>(
        object,
        operation.slice(4),
      );
    if (operation.startsWith("get:")) return get(operation.slice(4));
    switch (operation) {
      case "identity":
        return identity;
      case "attached":
        return true;
      case "contract": {
        if (
          typeof get("name") !== "string" ||
          typeof get("message") !== "string"
        )
          return false;
        if (!hasProperty<ScriptPropertyKey, unknown>(object, "stack"))
          return true;
        const stack = get("stack");
        return stack === undefined || typeof stack === "string";
      }
      case "message":
      case "name":
      case "stack": {
        const result = get(operation);
        if (
          typeof result === "string" ||
          (operation === "stack" && result === undefined)
        )
          return result;
        throw createRuntimeError(realm, "type");
      }
      default: {
        if (!hasProperty<ScriptPropertyKey, unknown>(global, operation))
          throw createRuntimeError(realm, "reference");
        const constructor = getProperty<ScriptPropertyKey, unknown>(
          global,
          operation,
          global,
          hooks,
        );
        const result = instanceOfValue(value, constructor, hooks, realm);
        if (result.error !== "none") throw createRuntimeError(realm, "type");
        return result.value;
      }
    }
  };
}

/** Enroll a realm argument in the typed error bridge, preserving identity. */
export function prepareRealmErrorArgument(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return value;
  const access = exoticSlots(object).internalTypedErrorAccess;
  if (access !== undefined) return access("identity");
  attachTypedErrorAccess(object, value, value, realm, hooks, global);
  return value;
}

export function createNativeErrorView(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  kind: string,
  message: string,
  hasMessage: boolean,
  native: unknown,
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createRuntimeError(realm, kind);
  if (hasMessage)
    builtinProperty(object, "message", message, true, true, hooks);
  attachTypedErrorAccess(object, object, native, realm, hooks, global);
  return object;
}
/** Node's coded errors use ordinary data properties. The producer supplies
 * the ordering used by its own constructor or native error callback. */
export function createCodedRuntimeError(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  kind: string,
  message: string,
  code: string,
  errno: number | undefined,
  codeFirst: boolean,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createRuntimeError(realm, kind);
  if (codeFirst)
    createDataProperty<ScriptPropertyKey, unknown>(object, "code", code, hooks);
  builtinProperty(object, "message", message, true, true, hooks);
  if (errno !== undefined)
    createDataProperty<ScriptPropertyKey, unknown>(
      object,
      "errno",
      errno,
      hooks,
    );
  if (!codeFirst)
    createDataProperty<ScriptPropertyKey, unknown>(object, "code", code, hooks);
  return object;
}

export function createNativeCodedErrorView(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  kind: string,
  message: string,
  code: string,
  errno: number | undefined,
  codeFirst: boolean,
  native: unknown,
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createCodedRuntimeError(
    realm,
    hooks,
    kind,
    message,
    code,
    errno,
    codeFirst,
  );
  attachTypedErrorAccess(object, object, native, realm, hooks, global);
  return object;
}

export function createNativeSystemErrorView(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  message: string,
  errno: number,
  code: string,
  text: string,
  syscall: string,
  native: unknown,
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const key = "node:system-error";
  const errorPrototype = realm.prototypes.get("error");
  if (errorPrototype === undefined) throw "ERROR_PROTOTYPE_INVARIANT";
  const existing = realm.prototypes.get(key);
  const prototype =
    existing ?? createObject<ScriptPropertyKey, unknown>(errorPrototype);
  if (existing === undefined) realm.prototypes.set(key, prototype);
  const object = errorFromPrototype(prototype, realm.agent, "SystemError");
  const info = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  createDataProperty<ScriptPropertyKey, unknown>(info, "errno", errno, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(info, "code", code, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(info, "message", text, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(
    info,
    "syscall",
    syscall,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    object,
    "code",
    "ERR_SYSTEM_ERROR",
    hooks,
  );
  builtinProperty(object, "name", "SystemError", true, true, hooks);
  builtinProperty(object, "message", message, true, true, hooks);
  defineOwnProperty<ScriptPropertyKey, unknown>(
    object,
    "info",
    {
      fields: 51,
      value: info,
      writable: false,
      enumerable: true,
      configurable: true,
      get: undefined,
      set: undefined,
    },
    hooks,
  );
  function alias(key: string): void {
    const get = builtinFunction(
      realm.functionPrototype,
      "get",
      0,
      (receiver, args): unknown =>
        getProperty<ScriptPropertyKey, unknown>(info, key, info, hooks),
      hooks,
    );
    const set = builtinFunction(
      realm.functionPrototype,
      "set",
      1,
      (receiver, args): unknown => {
        if (
          !setProperty<ScriptPropertyKey, unknown>(
            info,
            key,
            args[0],
            { object: info, value: info },
            hooks,
          )
        )
          throw createRuntimeError(realm, "type");
        return undefined;
      },
      hooks,
    );
    defineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      {
        fields: 60,
        value: undefined,
        writable: false,
        enumerable: true,
        configurable: true,
        get,
        set,
      },
      hooks,
    );
  }
  alias("errno");
  alias("syscall");
  attachTypedErrorAccess(object, object, native, realm, hooks, global);
  return object;
}
/** Resource cleanup uses intrinsic failure objects, without invoking a mutable
 * global SuppressedError constructor or performing message coercion. */
export function createSuppressedRuntimeError(
  realm: ErrorRealm,
  error: unknown,
  suppressed: unknown,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result = createRuntimeError(realm, "suppressed");
  initializeSuppressedError(result, error, suppressed, hooks);
  return result;
}
function initializeSuppressedError(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  error: unknown,
  suppressed: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(target, "error", error, true, true, hooks);
  builtinProperty(target, "suppressed", suppressed, true, true, hooks);
}
function errorFromPrototype(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  agent: ScriptAgent,
  name: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const error = createObject<ScriptPropertyKey, unknown>(prototype);
  ensureExoticSlots(error).internalErrorData = true;
  let trace = name;
  const frames = activeExecutionNames(agent, prototype);
  for (const frameName of frames)
    trace += "\n    at " + (frameName || "<anonymous>");
  const sourceFrames = frames.length;
  const active = agent.activeContext;
  if (sourceFrames === 0 && active !== undefined)
    trace +=
      active.scriptOrModule === undefined
        ? "\n    at <runtime>"
        : "\n    at <script>";
  ensureExoticSlots(error).internalErrorStack = trace;
  return error;
}

export function rejectUnsupportedExecution(realm: ErrorRealm): never {
  realm.unsupported = true;
  throw undefined;
}
/** Complete a lowered runtime result's error: "none" continues, "unsupported"
 * rejects the execution, and any other kind throws its engine-created error.
 * Lowered Scripts call this once per result instead of inlining both checks. */
export function throwIfRuntimeError(realm: ErrorRealm, error: string): void {
  if (error === "none") return;
  if (error === "unsupported") rejectUnsupportedExecution(realm);
  throw createRuntimeError(realm, error);
}
/** Shared result identity for AOT Scripts and runtime-compiled entries. */
export interface ScriptCompletionRecord {
  readonly error: string;
  readonly value: unknown;
}
/** The managed allocators throw a preallocated runtime closure when the heap
 * stays full after collection. A Script can only produce primitives, ordinary
 * objects (functions, proxies and namespaces included), symbols and bigints,
 * so a thrown reference that none of those views accepts is engine-internal:
 * reaching JavaScript would be an engine bug, so it is always an abort. This
 * needs no identity shared with the runtime unit, and every Script-thrown
 * value (including any string) stays ordinary. */
export function isEngineAbort(realm: ErrorRealm, value: unknown): boolean {
  if (typeof value === "function") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    viewObjectValue(value, realm.objectPrototype) === undefined &&
    viewSymbolValue(value) === undefined &&
    viewBigIntValue(value) === undefined
  );
}
/** A stack overflow or an impossible allocation observed at a JavaScript
 * boundary: the native stack guard, and the allocators for a request no heap
 * can satisfy (such as a string above the maximum length), throw a value that
 * no JavaScript value equals (undefined with a reserved payload). It becomes
 * a fresh RangeError of this realm. Recognition
 * depends only on the value, so an overflow that runtime code swallowed leaves
 * nothing behind, a JavaScript throw of undefined is never one, and an
 * overflow still unwinding is recognized however many unrelated catches ran
 * meanwhile. Other values have their ordinary treatment (undefined result). */
function stackOverflowError(realm: ErrorRealm, value: unknown): unknown {
  const guard = realm.agent.stackGuard;
  return guard !== undefined && guard.isOverflow(value)
    ? createRuntimeError(realm, "range")
    : undefined;
}
/** Every boundary where a thrown host value would become observable to
 * JavaScript (catch bindings, promise rejection, disposal and job error
 * reporting) passes it through this and uses the result. A stack overflow
 * becomes a RangeError. An engine abort marks the realm unsupported,
 * like the code budget and other engine limits, and keeps propagating, so no
 * handler runs with it. */
export function rejectEngineAbort(realm: ErrorRealm, value: unknown): unknown {
  const overflow = stackOverflowError(realm, value);
  if (overflow !== undefined) return overflow;
  if (!isEngineAbort(realm, value)) return value;
  realm.unsupported = true;
  throw value;
}
export function finishScriptExecution(
  realm: ErrorRealm,
  error: string,
  value: unknown,
): ScriptCompletionRecord {
  let completed = value;
  if (error === "throw") {
    const overflow = stackOverflowError(realm, value);
    if (overflow !== undefined) completed = overflow;
    else if (isEngineAbort(realm, value)) realm.unsupported = true;
  }
  return realm.unsupported
    ? { error: "unsupported", value: undefined }
    : { error, value: completed };
}

function messageString(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
  if (converted.error === "type") throw createRuntimeError(realm, "type");
  return converted.value;
}

export function installErrorIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function install(
    kind: string,
    name: string,
    parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): void {
    const prototype = realm.prototypes.get(kind);
    if (prototype === undefined) throw "ERROR_PROTOTYPE_INVARIANT";
    function initialize(
      args: readonly unknown[],
      selected: OrdinaryObject<ScriptPropertyKey, unknown>,
    ): unknown {
      const error = errorFromPrototype(selected, realm.agent, name);
      const aggregate = kind === "aggregate",
        suppressed = kind === "suppressed";
      const message = args[suppressed ? 2 : aggregate ? 1 : 0];
      if (message !== undefined)
        builtinProperty(
          error,
          "message",
          messageString(message, realm, hooks),
          true,
          true,
          hooks,
        );
      // SuppressedError has no options argument and never installs a cause.
      const options = suppressed
        ? undefined
        : viewObjectValue(args[aggregate ? 2 : 1], realm.objectPrototype);
      if (
        options !== undefined &&
        hasProperty<ScriptPropertyKey, unknown>(options, "cause")
      ) {
        const cause = getProperty<ScriptPropertyKey, unknown>(
          options,
          "cause",
          options,
          hooks,
        );
        builtinProperty(error, "cause", cause, true, true, hooks);
      }
      if (suppressed) {
        initializeSuppressedError(error, args[0], args[1], hooks);
      }
      if (aggregate) {
        const iterator = getScriptIterator(args[0], realm, hooks);
        const errors = collectScriptIterator(iterator, realm, hooks);
        builtinProperty(error, "errors", errors, true, true, hooks);
      }
      return error;
    }
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      parent,
      (receiver, args): unknown => initialize(args, prototype),
      (args, targetValue): unknown => {
        const target = viewObjectValue(targetValue, realm.objectPrototype);
        if (target === undefined) throw "ERROR_NEWTARGET_INVARIANT";
        const selectedValue = getProperty<ScriptPropertyKey, unknown>(
          target,
          "prototype",
          targetValue,
          hooks,
        );
        const selected = viewObjectValue(selectedValue, realm.objectPrototype);
        if (selected !== undefined) return initialize(args, selected);
        const fallback = getFunctionRealm(target, realm).prototypes.get(kind);
        if (fallback === undefined) throw "ERROR_PROTOTYPE_INVARIANT";
        return initialize(args, fallback);
      },
    );
    ensureExoticSlots(constructor).internalInitialName = name;
    realm.constructors.set(kind, constructor);
    builtinProperty(
      constructor,
      "length",
      kind === "suppressed" ? 3 : kind === "aggregate" ? 2 : 1,
      false,
      true,
      hooks,
    );
    builtinProperty(constructor, "name", name, false, true, hooks);
    builtinProperty(constructor, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", constructor, true, true, hooks);
    builtinProperty(global, name, constructor, true, true, hooks);
  }
  install("error", "Error", realm.functionPrototype);
  const base = realm.constructors.get("error");
  if (base === undefined) throw "ERROR_CONSTRUCTOR_INVARIANT";
  builtinProperty(
    base,
    "isError",
    builtinFunction(
      realm.functionPrototype,
      "isError",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(args[0], realm.objectPrototype);
        return object !== undefined && exoticSlots(object).internalErrorData;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  install("type", "TypeError", base);
  install("reference", "ReferenceError", base);
  install("syntax", "SyntaxError", base);
  install("range", "RangeError", base);
  install("eval", "EvalError", base);
  install("uri", "URIError", base);
  install("aggregate", "AggregateError", base);
  install("suppressed", "SuppressedError", base);
  const toString = createCallableObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      const object = viewObjectValue(receiver, realm.objectPrototype);
      if (object === undefined) throw createRuntimeError(realm, "type");
      const nameValue = getProperty<ScriptPropertyKey, unknown>(
        object,
        "name",
        receiver,
        hooks,
      );
      const name =
        nameValue === undefined
          ? "Error"
          : messageString(nameValue, realm, hooks);
      const messageValue = getProperty<ScriptPropertyKey, unknown>(
        object,
        "message",
        receiver,
        hooks,
      );
      const message =
        messageValue === undefined
          ? ""
          : messageString(messageValue, realm, hooks);
      if (name === "") return message;
      if (message === "") return name;
      return name + ": " + message;
    },
  );
  builtinFunctionMetadata(toString, "toString", 0, hooks);
  const prototype = realm.prototypes.get("error");
  if (prototype === undefined) throw "ERROR_PROTOTYPE_INVARIANT";
  builtinProperty(prototype, "toString", toString, true, true, hooks);
  // https://tc39.es/proposal-error-stack-accessor/
  // Read the ErrorData brand directly: neither inheritance nor Proxy targets
  // grant the slot, and public property writes do not replace the snapshot.
  builtinAccessor(
    prototype,
    "stack",
    builtinFunction(
      realm.functionPrototype,
      "get stack",
      0,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw createRuntimeError(realm, "type");
        return exoticSlots(object).internalErrorData
          ? exoticSlots(object).internalErrorStack
          : undefined;
      },
      hooks,
    ),
    builtinFunction(
      realm.functionPrototype,
      "set stack",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        const value = args[0];
        if (object === undefined || typeof value !== "string")
          throw createRuntimeError(realm, "type");
        if (object === prototype) throw createRuntimeError(realm, "type");
        const accepted =
          getOwnProperty<ScriptPropertyKey, unknown>(object, "stack") ===
          undefined
            ? createDataProperty<ScriptPropertyKey, unknown>(
                object,
                "stack",
                value,
                hooks,
              )
            : setProperty<ScriptPropertyKey, unknown>(
                object,
                "stack",
                value,
                { object, value: receiver },
                hooks,
              );
        if (!accepted) throw createRuntimeError(realm, "type");
        return undefined;
      },
      hooks,
    ),
    hooks,
  );
}
