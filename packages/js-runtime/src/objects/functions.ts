import type { TypedArrayElementKind } from "./typed-array-data.ts";
import { getFunctionRealm } from "./function-realms.ts";
import { scriptBoolean } from "./values.ts";
import {
  createSourceExecutionContext,
  createFunctionRealmContext,
  enterSourceCall,
  exitSourceCall,
  visibleSourceCaller,
} from "./jobs.ts";
import { callObject } from "./call.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createObject,
  createCallableObject,
  createConstructorObject,
  getProperty,
  hasPrototype,
  type ObjectCall,
  type ObjectCallDispatch,
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
  | "intl-collator"
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
  if (name === "intl-relative-time-format")
    return realm.relativeTimeFormatPrototype;
  if (name === "intl-plural-rules") return realm.pluralRulesPrototype;
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
    fn.internalTailDispatch = (receiver, args) =>
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
): { readonly error: "none" | "type"; readonly value: boolean } {
  const fn = viewObjectValue(constructor, realm.objectPrototype);
  if (fn === undefined || fn.internalCall === undefined)
    return { error: "none", value: false };
  const boundTarget = fn.internalBoundTarget;
  if (boundTarget !== undefined)
    return instanceOfValue(value, boundTarget, hooks, realm);
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return { error: "none", value: false };
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
    value: hasPrototype<ScriptPropertyKey, unknown>(object, prototype),
  };
}

/** InstanceofOperator obtains the hook before requiring callable fallback. */
export function instanceOfValue(
  value: unknown,
  constructor: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
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
  return ordinaryHasInstance(value, constructor, hooks, realm);
}

/** Source text is compiler-supplied metadata, never obtained from JS properties. */
export function retainFunctionSource(
  fn: OrdinaryObject<ScriptPropertyKey, unknown>,
  source: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  fn.internalSourceText = source;
  return fn;
}
