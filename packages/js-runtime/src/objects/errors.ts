import type { RealmReferrer } from "../modules/referrer.ts";
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
  type SymbolRegistry,
  type SymbolValue,
} from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createObject,
  createCallableObject,
  createConstructorObject,
  getProperty,
  hasProperty,
  preventExtensions,
  makePrototypeImmutable,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectExecutionContext,
} from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { createArrayObject, type ArrayObjectHooks } from "./arrays.ts";
import { scriptPropertyKeyOrder } from "./symbols.ts";
import { stringValue, numberValue } from "./coercion.ts";
import {
  builtinFunctionMetadata,
  builtinProperty,
  builtinFunction,
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
  readonly pluralRulesPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly relativeTimeFormatPrototype: OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
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
  readonly typedArrayPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly typedArrayPrototypes: Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >;
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
  readonly throwTypeError: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly functionPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly objectPrototype: OrdinaryObject<ScriptPropertyKey, unknown>;
  /** Sticky embedding diagnostic; reset only at the start of a new host job. */
  unsupported: boolean;
  readonly prototypes: Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>;
  readonly constructors: Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >;
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
    run: (action): unknown => {
      const active = agent.activeContext;
      return runScriptContext<unknown>(
        agent,
        {
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
      throw errorFromPrototype(typePrototype);
    },
  );
  throwTypeError.internalInitialName = "";
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
    fromNumber: (value): unknown => value,
    toNumber: (value): number => {
      const current = activeArrayRealm();
      const result = numberValue(value, hooks, current);
      if (result.error === "unsupported") rejectUnsupportedExecution(current);
      if (result.error === "type") throw createRuntimeError(current, "type");
      return result.value;
    },
    rangeError: (): unknown => createRuntimeError(activeArrayRealm(), "range"),
  };
  const arrayPrototype = createArrayObject<ScriptPropertyKey, unknown>(
    0,
    objectPrototype,
    arrayHooks,
    hooks,
  );
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
    abstractModuleSourceConstructor: undefined,
    abstractModuleSourcePrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    moduleLoader: undefined,
    realmReferrer: undefined,
    supportedImportAttributes: importAttributes,
    dynamicFunctionCompiler: undefined,
    evalFunction: undefined,
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
    dataViewPrototype: createObject<ScriptPropertyKey, unknown>(
      objectPrototype,
    ),
    bufferMaxBytes: 16777216,
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
    throwTypeError,
    prototypes,
    constructors: new Map<string, OrdinaryObject<ScriptPropertyKey, unknown>>(),
    objectPrototype,
    functionPrototype,
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
      const source = fn.internalSourceText;
      if (source !== undefined) return source;
      const name = fn.internalInitialName;
      if (name !== undefined)
        return "function " + name + "() { [native code] }";
      if (
        fn.internalBoundTarget !== undefined ||
        fn.internalProxyData !== undefined
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
  return errorFromPrototype(prototype);
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
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const error = createObject<ScriptPropertyKey, unknown>(prototype);
  error.internalErrorData = true;
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
export function finishScriptExecution(
  realm: ErrorRealm,
  error: string,
  value: unknown,
): ScriptCompletionRecord {
  return realm.unsupported
    ? { error: "unsupported", value: undefined }
    : { error, value };
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
      const error = errorFromPrototype(selected);
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
    constructor.internalInitialName = name;
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
        return object !== undefined && object.internalErrorData;
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
}
