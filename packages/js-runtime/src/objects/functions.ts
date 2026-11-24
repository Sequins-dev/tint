import type { TypedArrayElementKind } from "./typed-array-data.ts";
import { getFunctionRealm } from "./function-realms.ts";
import { checkPrimitiveContract, scriptBoolean } from "./values.ts";
import {
  createSourceExecutionContext,
  createFunctionRealmContext,
  functionExecutionContext,
  enterSourceCall,
  enterRegisterSourceCall,
  exitSourceCall,
  enterExecutionName,
  leaveExecutionName,
  visibleSourceCaller,
  activeSourceArguments,
} from "./jobs.ts";
import { createArgumentsObject } from "./arguments.ts";
import { callObject } from "./call.ts";
import {
  wellKnownSymbol,
  propertyFunctionName,
  type ScriptPropertyKey,
} from "./symbols.ts";
import {
  createObject,
  createCallableObject,
  createConstructorObject,
  ensureRareSlots,
  getProperty,
  hasPrototype,
  type ObjectCall,
  type ObjectScriptCall,
  type ObjectCallDispatch,
  type ObjectRegisterCall,
  type ObjectWideRegisterCall,
  type ObjectExecutionContext,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { makeMethod } from "./methods.ts";
import { constructObject } from "./call.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  functionMetadata,
  builtinProperty,
  builtinAccessor,
  builtinFunction,
} from "./intrinsics.ts";

type IntrinsicPrototype =
  | "shadow-realm"
  | "function"
  | "async-function"
  | "generator-function"
  | "async-generator-function"
  | "async-disposable-stack"
  | "disposable-stack"
  | "date"
  | TypedArrayElementKind
  | "temporal-plain-year-month"
  | "temporal-plain-month-day"
  | "temporal-zoned-date-time"
  | "temporal-plain-time"
  | "temporal-instant"
  | "intl-locale"
  | "intl-list-format"
  | "intl-segmenter"
  | "intl-collator"
  | "intl-date-time-format"
  | "intl-duration-format"
  | "intl-display-names"
  | "intl-relative-time-format"
  | "intl-plural-rules"
  | "intl-number-format"
  | "temporal-plain-date-time"
  | "temporal-duration"
  | "temporal-plain-date"
  | "object"
  | "array"
  | "array-buffer"
  | "shared-array-buffer"
  | "data-view"
  | "promise"
  | "set"
  | "map"
  | "weak-map"
  | "weak-set"
  | "weak-ref"
  | "finalization-registry"
  | "iterator"
  | "generator"
  | "async-generator"
  | "regexp"
  | "boolean"
  | "number"
  | "string";
function intrinsicPrototype(
  realm: ErrorRealm,
  name: IntrinsicPrototype,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (name === "function") return realm.functionPrototype;
  if (name === "shadow-realm") return realm.shadowRealmPrototype;
  if (name === "async-function") return realm.asyncFunctionPrototype;
  if (name === "generator-function") return realm.generatorFunctionPrototype;
  if (name === "async-generator-function")
    return realm.asyncGeneratorFunctionPrototype;
  const typedArray = realm.typedArrayPrototypes.get(name);
  if (typedArray !== undefined) return typedArray;
  if (name === "temporal-plain-year-month")
    return realm.temporalPlainYearMonthPrototype;
  if (name === "temporal-plain-month-day")
    return realm.temporalPlainMonthDayPrototype;
  if (name === "temporal-zoned-date-time")
    return realm.temporalZonedDateTimePrototype;
  if (name === "temporal-plain-time") return realm.temporalPlainTimePrototype;
  if (name === "temporal-instant") return realm.temporalInstantPrototype;
  if (name === "intl-locale") return realm.localePrototype;
  if (name === "intl-collator") return realm.collatorPrototype;
  if (name === "intl-list-format") return realm.listFormatPrototype;
  if (name === "intl-segmenter") return realm.segmenterPrototype;
  if (name === "intl-duration-format") return realm.durationFormatPrototype;
  if (name === "intl-display-names") return realm.displayNamesPrototype;
  if (name === "intl-relative-time-format")
    return realm.relativeTimeFormatPrototype;
  if (name === "intl-plural-rules") return realm.pluralRulesPrototype;
  if (name === "intl-date-time-format") return realm.dateTimeFormatPrototype;
  if (name === "intl-number-format") return realm.numberFormatPrototype;
  if (name === "temporal-plain-date-time")
    return realm.temporalPlainDateTimePrototype;
  if (name === "temporal-duration") return realm.temporalDurationPrototype;
  if (name === "temporal-plain-date") return realm.temporalPlainDatePrototype;
  if (name === "disposable-stack") return realm.disposableStackPrototype;
  if (name === "async-disposable-stack")
    return realm.asyncDisposableStackPrototype;
  if (name === "date") return realm.datePrototype;
  if (name === "promise") return realm.promisePrototype;
  if (name === "data-view") return realm.dataViewPrototype;
  if (name === "array-buffer") return realm.arrayBufferPrototype;
  if (name === "shared-array-buffer") return realm.sharedArrayBufferPrototype;
  if (name === "array") return realm.arrayPrototype;
  if (name === "set") return realm.setPrototype;
  if (name === "map") return realm.mapPrototype;
  if (name === "weak-map") return realm.weakMapPrototype;
  if (name === "weak-set") return realm.weakSetPrototype;
  if (name === "weak-ref") return realm.weakRefPrototype;
  if (name === "finalization-registry")
    return realm.finalizationRegistryPrototype;
  if (name === "iterator") return realm.iteratorPrototype;
  if (name === "generator") return realm.generatorPrototype;
  if (name === "async-generator") return realm.asyncGeneratorPrototype;
  if (name === "regexp") return realm.regexpPrototype;
  if (name === "boolean") return realm.booleanPrototype;
  if (name === "number") return realm.numberPrototype;
  if (name === "string") return realm.stringPrototype;
  return realm.objectPrototype;
}
/** GetPrototypeFromConstructor selects fallback intrinsics in newTarget's realm. */
export function constructorPrototype(
  newTarget: unknown,
  fallback: IntrinsicPrototype,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const target = viewObjectValue(newTarget, realm.objectPrototype);
  if (target === undefined) throw "CONSTRUCT_NEWTARGET_INVARIANT";
  const value = getProperty<ScriptPropertyKey, unknown>(
    target,
    "prototype",
    newTarget,
    hooks,
  );
  const selected = viewObjectValue(value, realm.objectPrototype);
  return selected === undefined
    ? intrinsicPrototype(getFunctionRealm(target, realm), fallback)
    : selected;
}

/** OrdinaryCreateFromConstructor(newTarget, "%Object.prototype%") for a
 * native entry's construction in its own realm, given the value of the
 * target's "prototype": an ordinary object with that prototype, or with the
 * realm's Object.prototype when the value is not an object. */
export function createSourceInstance(
  prototype: unknown,
  realm: ErrorRealm,
): unknown {
  return createObject<ScriptPropertyKey, unknown>(
    viewObjectValue(prototype, realm.objectPrototype) ?? realm.objectPrototype,
  );
}

/** Source execution receives the actual function object, independently of its
 * mutable source binding. Calls pass undefined newTarget; construction preserves
 * the actual target independently of the function identity. */
export type SourceFunctionCall = (
  receiver: unknown,
  args: readonly unknown[],
  callee: unknown,
  newTarget: unknown,
) => unknown;

/** Internal body carriers do not add an ECMAScript invocation. Only ordinary
 * non-strict functions may expose their own legacy caller accessor. */
export type SourceCallerPolicy = "none" | "opaque" | "visible" | "legacy";
/** A request belongs to one synchronous source invocation. Nested ordinary
 * calls install separate frames and restore their parent on every exit. */
export interface SourceTailCallFrame {
  pending: ObjectCallDispatch<ScriptPropertyKey, unknown> | undefined;
}

export function runSourceTailCallStep(
  action: () => unknown,
  execution: ObjectExecutionContext<unknown>,
  realm: ErrorRealm,
): ObjectCallDispatch<ScriptPropertyKey, unknown> {
  const agent = realm.agent;
  const previous = agent.activeTailCallFrame;
  const frame: SourceTailCallFrame = { pending: undefined };
  agent.activeTailCallFrame = frame;
  let value: unknown;
  try {
    value = execution.run(action);
  } finally {
    agent.activeTailCallFrame = previous;
  }
  const pending = frame.pending;
  return pending === undefined ? { kind: "return", value } : pending;
}

/** Called only at compiler-selected tail positions, after operand evaluation.
 * Reject a non-callable target before eliminating the source context. */
export function requestSourceTailCall(
  value: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "type"; readonly value: unknown } {
  const target = viewObjectValue(value, witness);
  if (target === undefined || target.internalCall === undefined)
    return { error: "type", value: undefined };
  const frame = realm.agent.activeTailCallFrame;
  if (frame === undefined || frame.pending !== undefined)
    throw "TAIL_CALL_OWNER_INVARIANT";
  frame.pending = { kind: "call", target, receiver, arguments: arguments_ };
  return { error: "none", value: undefined };
}

/** Ordinary base functions only. Derived construction and new.target expression
 * handling build on the separate construct capability, not callable detection. */
export function createSourceFunction(
  implementation: SourceFunctionCall,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
  callerPolicy: SourceCallerPolicy = "opaque",
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return sourceFunction(
    implementation,
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    false,
    callerPolicy,
  );
}

/** A source function with a native script entry (`scriptInvoke`) and its
 * list bridge (`implementation`). A body with tail calls requests them
 * from its list invocation's trampoline (`tailCalls`). */
export function createNativeSourceFunction(
  implementation: SourceFunctionCall,
  scriptInvoke: ObjectScriptCall<unknown>,
  tailCalls: boolean,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  callerPolicy: SourceCallerPolicy,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const fn = sourceFunction(
    implementation,
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    tailCalls,
    callerPolicy,
  );
  fn.internalRegisterCall = {
    context: functionExecutionContext(realm),
    traceName: name,
    callerPolicy,
    constructible,
    invoke: undefined,
    invokeWide: undefined,
    scriptInvoke,
  };
  return fn;
}

/** Only generated native entry bodies use these two lowering intrinsics. */
export function sourceArgumentCount(): number {
  throw "SOURCE_ARGUMENT_INTRINSIC";
}
export function sourceArgument(_index: number): unknown {
  throw "SOURCE_ARGUMENT_INTRINSIC";
}

/** A source body that needs at most two fixed parameters and does not read
 * its arguments binding. The general entry still supports apply, construct,
 * extra arguments and callers with a different execution context. */
export function createRegisterSourceFunction(
  implementation: ObjectRegisterCall<unknown>,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  callerPolicy: SourceCallerPolicy,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const agent = realm.agent;
  const fn = createSourceFunction(
    (receiver, args, callee, newTarget): unknown =>
      implementation(
        callee,
        receiver,
        newTarget,
        args.length,
        args[0],
        args[1],
      ),
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    callerPolicy,
  );
  fn.internalRegisterCall = {
    context: functionExecutionContext(realm),
    traceName: name,
    callerPolicy,
    constructible,
    invokeWide: undefined,
    invoke: (callee, receiver, newTarget, count, first, second): unknown => {
      const trace = enterExecutionName(agent, name);
      const depth = enterRegisterSourceCall(
        agent,
        callerPolicy === "opaque" ? undefined : callee,
        callerPolicy === "legacy" ? count : -1,
        first,
        second,
      );
      try {
        return implementation(
          callee,
          receiver,
          newTarget,
          count,
          first,
          second,
        );
      } finally {
        exitSourceCall(agent, depth);
        leaveExecutionName(agent, trace);
      }
    },
  };
  return fn;
}

/** A strict source body with up to six parameters and no arguments binding.
 * The ordinary source entry handles exotic callers and spread. */
export function createWideRegisterSourceFunction(
  implementation: ObjectWideRegisterCall<unknown>,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  callerPolicy: SourceCallerPolicy,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const agent = realm.agent;
  const fn = createSourceFunction(
    (receiver, args, callee, newTarget): unknown =>
      implementation(
        callee,
        receiver,
        newTarget,
        args.length,
        args[0],
        args[1],
        args[2],
        args[3],
        args[4],
        args[5],
      ),
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    callerPolicy,
  );
  const invoke: ObjectWideRegisterCall<unknown> = (
    callee,
    receiver,
    newTarget,
    count,
    first,
    second,
    third,
    fourth,
    fifth,
    sixth,
  ): unknown => {
    const trace = enterExecutionName(agent, name);
    const depth = enterSourceCall(agent, undefined);
    try {
      return implementation(
        callee,
        receiver,
        newTarget,
        count,
        first,
        second,
        third,
        fourth,
        fifth,
        sixth,
      );
    } finally {
      exitSourceCall(agent, depth);
      leaveExecutionName(agent, trace);
    }
  };
  fn.internalRegisterCall = {
    context: functionExecutionContext(realm),
    traceName: name,
    callerPolicy,
    constructible,
    invoke: (callee, receiver, newTarget, count, first, second): unknown =>
      invoke(
        callee,
        receiver,
        newTarget,
        count,
        first,
        second,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    invokeWide: invoke,
  };
  return fn;
}

/** Use the ordinary function's identity, receiver and construct path. A
 * return contract sees only the final normal completion after any finally. */
export function createCheckedSourceFunction(
  implementation: SourceFunctionCall,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  callerPolicy: SourceCallerPolicy,
  contract: number,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const checked: SourceFunctionCall = (receiver, args, callee, newTarget) =>
    checkPrimitiveContract(
      realm,
      implementation(receiver, args, callee, newTarget),
      contract,
    );
  return createSourceFunction(
    checked,
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    callerPolicy,
  );
}

/** Source callbacks whose compiler-selected return paths can request a transfer.
 * The callback ABI is unchanged; the invocation owns its context and request. */
export function createTailSourceFunction(
  implementation: SourceFunctionCall,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
  callerPolicy: SourceCallerPolicy = "opaque",
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return sourceFunction(
    implementation,
    constructible,
    realm,
    hooks,
    name,
    length,
    home,
    true,
    callerPolicy,
  );
}

function sourceFunction(
  implementation: SourceFunctionCall,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  tailCalls: boolean,
  callerPolicy: SourceCallerPolicy,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  // Published only after initialization; the cell closes the function identity
  // cycle without relying on a mutable source-level name or ambient call state.
  const identity: { value: unknown } = { value: undefined };
  const execute: SourceFunctionCall = (receiver, args, callee, newTarget) => {
    if (callerPolicy === "none")
      return implementation(receiver, args, callee, newTarget);
    const agent = realm.agent;
    const depth = enterSourceCall(
      agent,
      callerPolicy === "opaque" ? undefined : callee,
      callerPolicy === "legacy" ? args : undefined,
    );
    try {
      return implementation(receiver, args, callee, newTarget);
    } finally {
      exitSourceCall(agent, depth);
    }
  };
  const context = createSourceExecutionContext(realm, name, false);
  const metadata = tailCalls ? createFunctionRealmContext(realm) : context;
  const invoke: ObjectCall<unknown> = tailCalls
    ? (receiver, args): unknown =>
        finishSourceTailCall(
          runSourceTailCallStep(
            (): unknown => execute(receiver, args, identity.value, undefined),
            context,
            realm,
          ),
          realm,
        )
    : (receiver, args): unknown =>
        execute(receiver, args, identity.value, undefined);
  const fn = constructible
    ? createConstructorObject<ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        invoke,
        (args, targetValue): unknown => {
          const instance = createObject<ScriptPropertyKey, unknown>(
            constructorPrototype(targetValue, "object", realm, hooks),
          );
          const returned = tailCalls
            ? finishSourceTailCall(
                runSourceTailCallStep(
                  (): unknown =>
                    execute(instance, args, identity.value, targetValue),
                  context,
                  realm,
                ),
                realm,
              )
            : execute(instance, args, identity.value, targetValue);
          return viewObjectValue(returned, realm.objectPrototype) === undefined
            ? instance
            : returned;
        },
        metadata,
      )
    : createCallableObject<ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        invoke,
        metadata,
      );
  if (tailCalls)
    ensureRareSlots<ScriptPropertyKey, unknown>(fn).internalTailDispatch = (
      receiver,
      args,
    ) =>
      runSourceTailCallStep(
        (): unknown => execute(receiver, args, identity.value, undefined),
        context,
        realm,
      );
  if (home !== undefined) makeMethod<ScriptPropertyKey, unknown>(fn, home);
  identity.value = fn;
  functionMetadata(fn, name, length, hooks);
  if (callerPolicy === "legacy") {
    const getter = builtinFunction(
      realm.functionPrototype,
      "get caller",
      0,
      (_receiver, _args): unknown => {
        const caller = visibleSourceCaller(realm.agent, fn);
        return caller === undefined ? null : caller;
      },
      hooks,
    );
    builtinAccessor(fn, "caller", getter, undefined, hooks);
    // Legacy sloppy-function extension: an unmapped arguments object for the
    // innermost active invocation, or null. Forbidden-extension functions
    // never take this policy and keep Function.prototype's poison pills.
    const argumentsGetter = builtinFunction(
      realm.functionPrototype,
      "get arguments",
      0,
      (_receiver, _args): unknown => {
        const active = activeSourceArguments(realm.agent, fn);
        if (active === undefined) return null;
        const values = realm.arrayValues;
        if (values === undefined)
          throw "ARGUMENTS_ITERATOR_INTRINSIC_INVARIANT";
        return createArgumentsObject<ScriptPropertyKey, unknown>(
          active,
          undefined,
          {
            prototype: realm.objectPrototype,
            lengthKey: "length",
            calleeKey: "callee",
            iteratorKey: wellKnownSymbol(realm.symbolRegistry, "iterator"),
            values,
            throwTypeError: realm.throwTypeError,
            indexKey: (index): ScriptPropertyKey => String(index),
            numberValue: (value): unknown => value,
          },
          hooks,
        );
      },
      hooks,
    );
    builtinAccessor(fn, "arguments", argumentsGetter, undefined, hooks);
  }
  if (constructible) {
    const prototype = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    builtinProperty(prototype, "constructor", fn, true, true, hooks);
    builtinProperty(fn, "prototype", prototype, true, false, hooks);
  }
  return fn;
}

function finishSourceTailCall(
  step: ObjectCallDispatch<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): unknown {
  if (step.kind === "return") return step.value;
  const result = callObject<ScriptPropertyKey, unknown>(
    step.target,
    step.receiver,
    step.arguments,
    undefined,
  );
  if (result.error !== "none") {
    const active = realm.agent.activeContext;
    throw createRuntimeError(
      active === undefined ? realm : active.realm,
      result.error,
    );
  }
  return result.value;
}

export function constructObjectValue(
  value: unknown,
  args: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: unknown } {
  const object = viewObjectValue(value, witness);
  return constructObject<ScriptPropertyKey, unknown>(
    object,
    args,
    { value, object },
    undefined,
  );
}

/** OrdinaryHasInstance, including bound-function delegation to InstanceofOperator. */
export function ordinaryHasInstance(
  value: unknown,
  constructor: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
  nativePrototype?: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: boolean } {
  const fn = viewObjectValue(constructor, realm.objectPrototype);
  if (fn === undefined || fn.internalCall === undefined)
    return { error: "none", value: false };
  const rare = fn.internalRareSlots;
  const boundTarget = rare === undefined ? undefined : rare.internalBoundTarget;
  if (boundTarget !== undefined)
    return instanceOfValue(value, boundTarget, hooks, realm, nativePrototype);
  const object = viewObjectValue(value, realm.objectPrototype);
  const base = object ?? nativePrototype;
  if (base === undefined) return { error: "none", value: false };
  const prototypeValue = getProperty<ScriptPropertyKey, unknown>(
    fn,
    "prototype",
    constructor,
    hooks,
  );
  const prototype = viewObjectValue(prototypeValue, realm.objectPrototype);
  if (prototype === undefined) return { error: "type", value: false };
  return {
    error: "none",
    value:
      (object === undefined && base === prototype) ||
      hasPrototype<ScriptPropertyKey, unknown>(base, prototype),
  };
}

/** InstanceofOperator obtains the hook before requiring callable fallback. */
export function instanceOfValue(
  value: unknown,
  constructor: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
  nativePrototype?: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: boolean } {
  const object = viewObjectValue(constructor, realm.objectPrototype);
  if (object === undefined) return { error: "type", value: false };
  const method = getProperty<ScriptPropertyKey, unknown>(
    object,
    wellKnownSymbol(realm.symbolRegistry, "hasInstance"),
    constructor,
    hooks,
  );
  if (method !== undefined && method !== null) {
    if (
      nativePrototype !== undefined &&
      method === realm.ordinaryHasInstanceMethod
    )
      return ordinaryHasInstance(
        value,
        constructor,
        hooks,
        realm,
        nativePrototype,
      );
    const callable = viewObjectValue(method, realm.objectPrototype);
    const result = callObject<ScriptPropertyKey, unknown>(
      callable,
      constructor,
      [value],
      undefined,
    );
    if (result.error !== "none") return { error: "type", value: false };
    return {
      error: "none",
      value: scriptBoolean(result.value, realm.objectPrototype),
    };
  }
  if (object.internalCall === undefined) return { error: "type", value: false };
  return ordinaryHasInstance(value, constructor, hooks, realm, nativePrototype);
}

/** Source text is compiler-supplied metadata, never obtained from JS properties. */
/** createSourceFunction, propertyFunctionName and retainFunctionSource in one
 * call for runtime-compiled entries: the function is named from a property key
 * and keeps its exact source text, as the three separate calls would. */
export function createRetainedSourceFunction(
  implementation: SourceFunctionCall,
  constructible: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  key: ScriptPropertyKey,
  length: number,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  callerPolicy: SourceCallerPolicy,
  source: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return retainFunctionSource(
    createSourceFunction(
      implementation,
      constructible,
      realm,
      hooks,
      propertyFunctionName(key),
      length,
      home,
      callerPolicy,
    ),
    source,
  );
}
export function retainFunctionSource(
  fn: OrdinaryObject<ScriptPropertyKey, unknown>,
  source: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  fn.internalSourceText = source;
  return fn;
}
