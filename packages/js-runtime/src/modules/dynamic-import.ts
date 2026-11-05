import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "../objects/errors.ts";
import { canonicalModuleRequest } from "@tint/foundation/modules";
import { stringValue } from "../objects/coercion.ts";
import { viewObjectValue } from "../objects/values.ts";
import {
  getProperty,
  getOwnProperty,
  ownKeys,
  type ObjectHooks,
  type OrdinaryObject,
} from "../objects/operations.ts";
import {
  scriptPropertyKeyOrder,
  type ScriptPropertyKey,
} from "../objects/symbols.ts";
import { activeModuleReferrer } from "./referrer.ts";
import { builtinFunction } from "../objects/intrinsics.ts";
import { createScriptPromiseHooks } from "../objects/promises.ts";
import { performPromiseThen } from "../promises/index.ts";
import {
  loadRequestedModules,
  createModuleCapability,
  allImportAttributesSupported,
  type DynamicImportState,
  type ModuleCompletion,
} from "./loading.ts";
import { linkModule } from "./linking.ts";
import { evaluateModule } from "./evaluation.ts";
import { getModuleNamespace } from "./namespace.ts";

/** Host completion continues through ordinary Promise jobs, never inline module
 * execution. Each dynamic call owns its capability, even for a cached module. */
export function continueDynamicImport(
  realm: ErrorRealm,
  state: DynamicImportState,
  completion: ModuleCompletion,
): void {
  if (!completion.ok) {
    state.capability.functions.reject(completion.error);
    return;
  }
  const active = realm.agent.activeContext,
    current = active === undefined ? realm : active.realm,
    hooks = state.hooks,
    protocol = createScriptPromiseHooks(
      current,
      hooks,
      (promise, operation): void =>
        current.promiseRejectionTracker(promise, operation),
    ),
    module = completion.module,
    load = loadRequestedModules(module, hooks, undefined).internalPromiseData;
  if (load === undefined) throw "MODULE_PROMISE_INVARIANT";
  const onRejected = builtinFunction(
    current.functionPrototype,
    "",
    1,
    (_receiver, args): unknown => {
      state.capability.functions.reject(args[0]);
      return undefined;
    },
    hooks,
  );
  const onFulfilled = builtinFunction(
    current.functionPrototype,
    "",
    0,
    (_receiver, _args): unknown => {
      state.capability.functions.resolve(getModuleNamespace(module));
      return undefined;
    },
    hooks,
  );
  const linkAndEvaluate = builtinFunction(
    current.functionPrototype,
    "",
    0,
    (_receiver, _args): unknown => {
      const linked = linkModule(module);
      if (!linked.ok) {
        state.capability.functions.reject(linked.error);
        return undefined;
      }
      const evaluation = evaluateModule(module, hooks).internalPromiseData;
      if (evaluation === undefined) throw "MODULE_PROMISE_INVARIANT";
      performPromiseThen<unknown>(
        evaluation,
        onFulfilled,
        onRejected,
        undefined,
        protocol,
      );
      return undefined;
    },
    hooks,
  );
  performPromiseThen<unknown>(
    load,
    linkAndEvaluate,
    onRejected,
    undefined,
    protocol,
  );
}

/** Operand evaluation precedes this helper. Coercion and option failures reject
 * its fresh capability; embedding faults and sticky unsupported remain visible. */
export function evaluateImportCall(
  specifier: unknown,
  options: unknown,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const active = realm.agent.activeContext,
    current = active === undefined ? realm : active.realm,
    capability = createModuleCapability(current, hooks),
    referrer = activeModuleReferrer(realm);
  let convertedSpecifier = "";
  const attributes: { readonly key: string; readonly value: string }[] = [];
  try {
    const converted = stringValue(specifier, hooks, current);
    if (converted.error === "unsupported") rejectUnsupportedExecution(current);
    if (converted.error !== "none") throw createRuntimeError(current, "type");
    convertedSpecifier = converted.value;
    if (options !== undefined) {
      const object = viewObjectValue(options, current.objectPrototype);
      if (object === undefined) throw createRuntimeError(current, "type");
      const withValue = getProperty<ScriptPropertyKey, unknown>(
        object,
        "with",
        options,
        hooks,
      );
      if (withValue !== undefined) {
        const withObject = viewObjectValue(withValue, current.objectPrototype);
        if (withObject === undefined) throw createRuntimeError(current, "type");
        const keys = ownKeys<ScriptPropertyKey, unknown>(
          withObject,
          (key: ScriptPropertyKey): number => scriptPropertyKeyOrder(key),
        );
        for (const key of keys) {
          if (typeof key !== "string") continue;
          const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
            withObject,
            key,
          );
          if (descriptor === undefined || !descriptor.enumerable) continue;
          const value = getProperty<ScriptPropertyKey, unknown>(
            withObject,
            key,
            withValue,
            hooks,
          );
          if (typeof value !== "string")
            throw createRuntimeError(current, "type");
          attributes.push({ key, value });
        }
      }
    }
    if (!allImportAttributesSupported(current, attributes))
      throw createRuntimeError(current, "type");
  } catch (error) {
    if (current.unsupported) throw error;
    capability.functions.reject(error);
    return capability.promise;
  }
  const request = canonicalModuleRequest({
    specifier: convertedSpecifier,
    attributes,
  });
  const loader = referrer.realm.moduleLoader;
  if (loader === undefined) rejectUnsupportedExecution(current);
  loader(referrer, request, undefined, {
    kind: "dynamic",
    capability,
    hooks,
    finished: false,
  });
  return capability.promise;
}
