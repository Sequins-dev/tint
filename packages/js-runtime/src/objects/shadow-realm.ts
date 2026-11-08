import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { getFunctionRealm } from "./function-realms.ts";
import { enterSourceCall, exitSourceCall, runScriptContext } from "./jobs.ts";
import { functionMetadata } from "./intrinsics.ts";
import {
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { stringValue } from "./coercion.ts";
import { createScriptPromiseHooks } from "./promises.ts";
import { createModuleCapability } from "../modules/loading.ts";
import { evaluateImportCall } from "../modules/dynamic-import.ts";
import { performPromiseThen } from "../promises/index.ts";
import {
  createCallableObject,
  createConstructorObject,
  createObject,
  getOwnProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { callObject } from "./call.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** The engine reports parse/early errors separately from executed throws. */
export interface ShadowRealmEvaluation {
  readonly error: "none" | "syntax" | "throw";
  readonly value: unknown;
}
export interface ShadowRealmHost {
  readonly realm: ErrorRealm;
  readonly evaluate: (source: string) => ShadowRealmEvaluation;
}

/** Every entry into another realm, including metadata getters during wrapping,
 * hides source callers and starts without a Script/module referrer. */
function runShadowRealmContext<Value>(
  realm: ErrorRealm,
  action: () => Value,
): Value {
  const barrier = enterSourceCall(realm.agent, undefined);
  try {
    return runScriptContext<Value>(
      realm.agent,
      { realm, scriptOrModule: undefined },
      action,
    );
  } finally {
    exitSourceCall(realm.agent, barrier);
  }
}

function requireShadowRealm(
  value: unknown,
  realm: ErrorRealm,
): ShadowRealmHost {
  const object = viewObjectValue(value, realm.objectPrototype);
  const host = object === undefined ? undefined : object.internalShadowRealm;
  if (host === undefined) throw createRuntimeError(realm, "type");
  return host;
}

export function installShadowRealmIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  createHost: () => ShadowRealmHost,
): void {
  const prototype = realm.shadowRealmPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (_args, newTarget): unknown => {
      const instance = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(newTarget, "shadow-realm", realm, hooks),
      );
      instance.internalShadowRealm = createHost();
      return instance;
    },
  );
  builtinFunctionMetadata(constructor, "ShadowRealm", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "ShadowRealm",
    false,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "evaluate",
    builtinFunction(
      realm.functionPrototype,
      "evaluate",
      1,
      (receiver, args): unknown => {
        const host = requireShadowRealm(receiver, realm);
        const source = args[0];
        if (typeof source !== "string") throw createRuntimeError(realm, "type");
        const result = runShadowRealmContext<ShadowRealmEvaluation>(
          host.realm,
          (): ShadowRealmEvaluation => host.evaluate(source),
        );
        if (result.error !== "none")
          throw createRuntimeError(
            realm,
            result.error === "syntax" ? "syntax" : "type",
          );
        return getShadowRealmWrappedValue(realm, result.value);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "importValue",
    builtinFunction(
      realm.functionPrototype,
      "importValue",
      2,
      (receiver, args): unknown => {
        const host = requireShadowRealm(receiver, realm);
        const converted = stringValue(args[0], hooks, realm);
        if (converted.error !== "none") throw createRuntimeError(realm, "type");
        const exportName = args[1];
        if (typeof exportName !== "string")
          throw createRuntimeError(realm, "type");
        return importShadowRealmValue(host, converted.value, exportName, realm);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "ShadowRealm", constructor, true, true, hooks);
}

function importShadowRealmValue(
  host: ShadowRealmHost,
  specifier: string,
  name: string,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const inner = host.realm;
  const imported = runShadowRealmContext<unknown>(inner, (): unknown =>
    evaluateImportCall(specifier, undefined, inner.objectHooks, inner),
  );
  const object = viewObjectValue(imported, inner.objectPrototype);
  const promise = object === undefined ? undefined : object.internalPromiseData;
  if (promise === undefined) throw "SHADOW_REALM_IMPORT_PROMISE_INVARIANT";
  const hooks = realm.objectHooks;
  const capability = createModuleCapability(realm, hooks);
  const fulfilled = builtinFunction(
    realm.functionPrototype,
    "",
    1,
    (_receiver, args): unknown => {
      const namespace = viewObjectValue(args[0], inner.objectPrototype);
      if (
        namespace === undefined ||
        getOwnProperty<ScriptPropertyKey, unknown>(namespace, name) ===
          undefined
      )
        throw createRuntimeError(realm, "type");
      return getShadowRealmWrappedValue(
        realm,
        getProperty<ScriptPropertyKey, unknown>(
          namespace,
          name,
          args[0],
          hooks,
        ),
      );
    },
    hooks,
  );
  const rejected = builtinFunction(
    realm.functionPrototype,
    "",
    1,
    (_receiver, _args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    hooks,
  );
  performPromiseThen<unknown>(
    promise,
    fulfilled,
    rejected,
    capability.functions,
    createScriptPromiseHooks(realm, hooks, (value, operation): void =>
      realm.promiseRejectionTracker(value, operation),
    ),
  );
  return capability.promise;
}

/** A callable crossing gets a fresh wrapper each time, including a callable
 * that crosses back into its original realm. Object identity never crosses. */
export function getShadowRealmWrappedValue(
  realm: ErrorRealm,
  value: unknown,
): unknown {
  const target = viewObjectValue(value, realm.objectPrototype);
  if (target === undefined) return value;
  if (target.internalCall === undefined)
    throw createRuntimeError(realm, "type");
  const hooks = realm.objectHooks;
  const wrapped = createCallableObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      try {
        const targetRealm = getFunctionRealm(target, realm);
        const arguments_: unknown[] = [];
        for (const argument of args)
          arguments_.push(getShadowRealmWrappedValue(targetRealm, argument));
        const thisArgument = getShadowRealmWrappedValue(targetRealm, receiver);
        const result = callObject<ScriptPropertyKey, unknown>(
          target,
          thisArgument,
          arguments_,
          undefined,
        );
        if (result.error !== "none") throw createRuntimeError(realm, "type");
        return getShadowRealmWrappedValue(realm, result.value);
      } catch (error) {
        if (realm.unsupported) throw error;
        // Do not inspect or stringify the thrown value: even its properties may
        // run code in the other realm. The copied error belongs to the wrapper.
        throw createRuntimeError(realm, "type");
      }
    },
    {
      getRealm: (): ErrorRealm => realm,
      run: (action): unknown => runShadowRealmContext<unknown>(realm, action),
    },
  );
  try {
    runShadowRealmContext<unknown>(realm, (): unknown => {
      let length = 0;
      if (
        getOwnProperty<ScriptPropertyKey, unknown>(target, "length") !==
        undefined
      ) {
        const value = getProperty<ScriptPropertyKey, unknown>(
          target,
          "length",
          target,
          hooks,
        );
        if (typeof value === "number" && value > 0) length = Math.floor(value);
      }
      const name = getProperty<ScriptPropertyKey, unknown>(
        target,
        "name",
        target,
        hooks,
      );
      functionMetadata(
        wrapped,
        typeof name === "string" ? name : "",
        length,
        hooks,
      );
      return undefined;
    });
  } catch (error) {
    if (realm.unsupported) throw error;
    throw createRuntimeError(realm, "type");
  }
  return wrapped;
}
