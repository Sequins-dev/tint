import {
  createSourceExecutionContext,
  runScriptContext,
  type ScriptExecutionContext,
} from "./jobs.ts";
import {
  createGeneratorRecord,
  resumeGenerator,
  resumeYieldDelegate,
  type GeneratorOutcome,
  type GeneratorResumeKind,
  type GeneratorStep,
  type GeneratorStepOutcome,
} from "../iterators/index.ts";
import {
  createObject,
  createCallableObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import {
  functionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import { makeMethod } from "./methods.ts";
import type { ScriptIterator } from "./iteration.ts";

export type GeneratorContinuation = (
  kind: GeneratorResumeKind,
  value: unknown,
) => GeneratorOutcome<unknown>;
export type GeneratorInitializer = (
  receiver: unknown,
  args: readonly unknown[],
  callee: unknown,
) => GeneratorContinuation;

/** Keep delegation suspended until it produces a normal expression value.
 * An injected return remains abrupt; a delegated yield preserves result identity.
 * The compiler's following continuation owns enclosing completion routing. */
export function createDelegatingContinuation(
  iterator: ScriptIterator,
  following: GeneratorStep<unknown>,
): GeneratorStep<unknown> {
  return (kind, value): GeneratorStepOutcome<unknown> => {
    const outcome = resumeYieldDelegate<unknown>(
      iterator.record,
      kind,
      value,
      iterator.hooks,
    );
    if (outcome.kind === "yield")
      return { kind: "yield", result: outcome.result };
    if (outcome.kind === "return")
      return { kind: "return", value: outcome.value };
    return {
      kind: "transfer",
      next: following,
      inputKind: "next",
      value: outcome.value,
    };
  };
}

/** Transfer an unstarted hidden carrier without exposing a second generator. */
export function takeGeneratorStart(
  value: unknown,
  realm: ErrorRealm,
): GeneratorContinuation {
  const object = viewObjectValue(value, realm.objectPrototype);
  const record = object?.internalGeneratorData;
  if (record === undefined || record.state !== "suspended-start")
    throw "DYNAMIC_GENERATOR_CARRIER_INVARIANT";
  const continuation = record.continuation;
  if (continuation === undefined) throw "DYNAMIC_GENERATOR_CARRIER_INVARIANT";
  record.state = "completed";
  record.continuation = undefined;
  return continuation;
}

/** Initialize parameters and declarations synchronously, then retain the native
 * body continuation without entering it. Prototype selection follows initializer
 * side effects, using the actual function identity rather than its source name. */
export function createSourceGeneratorFunction(
  initialize: GeneratorInitializer,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
  home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const identity: { value: unknown } = { value: undefined };
  const fn = createCallableObject<ScriptPropertyKey, unknown>(
    realm.generatorFunctionPrototype,
    (receiver, args): unknown => {
      const continuation = initialize(receiver, args, identity.value);
      const prototype = constructorPrototype(
        identity.value,
        "generator",
        realm,
        hooks,
      );
      return createGeneratorObject(continuation, realm, prototype);
    },
    createSourceExecutionContext(realm),
  );
  identity.value = fn;
  if (home !== undefined) makeMethod<ScriptPropertyKey, unknown>(fn, home);
  functionMetadata(fn, name, length, hooks);
  builtinProperty(
    fn,
    "prototype",
    createObject<ScriptPropertyKey, unknown>(realm.generatorPrototype),
    true,
    false,
    hooks,
  );
  return fn;
}

/** The compiler supplies a native continuation closing over its suspended frame.
 * The public object has no own next/return/throw properties or exposed state. */
export function createGeneratorObject(
  continuation: (
    kind: GeneratorResumeKind,
    value: unknown,
  ) => GeneratorOutcome<unknown>,
  realm: ErrorRealm,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generator = createObject<ScriptPropertyKey, unknown>(
    prototype === undefined ? realm.generatorPrototype : prototype,
  );
  const active = realm.agent.activeContext;
  const context: ScriptExecutionContext = {
    realm,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  };
  generator.internalGeneratorData = createGeneratorRecord<unknown>(
    (kind, value): GeneratorOutcome<unknown> =>
      runScriptContext<GeneratorOutcome<unknown>>(
        realm.agent,
        context,
        (): GeneratorOutcome<unknown> => continuation(kind, value),
      ),
  );
  return generator;
}

export function installGeneratorIntrinsics(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(
    realm.generatorFunctionPrototype,
    "prototype",
    realm.generatorPrototype,
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.generatorFunctionPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "GeneratorFunction",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.generatorPrototype,
    "constructor",
    realm.generatorFunctionPrototype,
    false,
    true,
    hooks,
  );
  const kinds: GeneratorResumeKind[] = ["next", "return", "throw"];
  for (const kind of kinds) {
    if (kind === undefined) throw "GENERATOR_METHOD_INVARIANT";
    builtinProperty(
      realm.generatorPrototype,
      kind,
      builtinFunction(
        realm.functionPrototype,
        kind,
        1,
        (receiver, args): unknown => {
          const object = viewObjectValue(receiver, realm.objectPrototype);
          const record =
            object === undefined ? undefined : object.internalGeneratorData;
          if (record === undefined) throw createRuntimeError(realm, "type");
          return resumeGenerator<unknown>(record, kind, args[0], {
            undefinedValue: undefined,
            typeError: (): unknown => createRuntimeError(realm, "type"),
            iteratorResult: (value, done): unknown =>
              createIteratorResult(value, done, realm, hooks),
          });
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(
    realm.generatorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Generator",
    false,
    true,
    hooks,
  );
}
