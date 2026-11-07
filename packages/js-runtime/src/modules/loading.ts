import { continueDynamicImport } from "./dynamic-import.ts";
import { recordLoadedModule, type ModuleReferrer } from "./referrer.ts";
import { moduleRequestsEqual } from "@tint/foundation/modules";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "../objects/errors.ts";
import {
  createPromiseObject,
  createScriptPromiseHooks,
} from "../objects/promises.ts";
import type { ObjectHooks, OrdinaryObject } from "../objects/operations.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";
import {
  createResolvingFunctions,
  type PromiseResolvingFunctions,
} from "../promises/index.ts";
import type { ModuleRecord, ModuleRequest } from "./records.ts";
export interface ModuleCapability {
  readonly promise: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly functions: PromiseResolvingFunctions<unknown>;
}
export type ModuleCompletion =
  | { readonly ok: true; readonly module: ModuleRecord }
  | { readonly ok: false; readonly error: unknown };
export interface GraphLoadingState {
  readonly kind: "graph";
  readonly capability: ModuleCapability;
  isLoading: boolean;
  pendingModulesCount: number;
  readonly visited: ModuleRecord[];
  readonly hostDefined: unknown;
}
export interface DynamicImportState {
  readonly kind: "dynamic";
  readonly capability: ModuleCapability;
  readonly hooks: ObjectHooks<unknown>;
  readonly phase?: ModuleRequest["phase"];
  readonly realm?: ErrorRealm;
  finished: boolean;
}
export type ModuleLoadPayload = GraphLoadingState | DynamicImportState;
export type ModuleLoader = (
  referrer: ModuleReferrer,
  request: ModuleRequest,
  hostDefined: unknown,
  payload: ModuleLoadPayload,
) => void;
export function createModuleCapability(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ModuleCapability {
  const promise = createPromiseObject(realm.promisePrototype),
    record = promise.internalPromiseData;
  if (record === undefined) throw "MODULE_PROMISE_INVARIANT";
  const protocol = createScriptPromiseHooks(
    realm,
    hooks,
    (promise, operation): void =>
      realm.promiseRejectionTracker(promise, operation),
  );
  return {
    promise,
    functions: createResolvingFunctions<unknown>(record, protocol),
  };
}
export function allImportAttributesSupported(
  realm: ErrorRealm,
  attributes: readonly { readonly key: string; readonly value: string }[],
): boolean {
  for (const attribute of attributes) {
    if (attribute === undefined) throw "MODULE_REQUEST_INVARIANT";
    if (!realm.supportedImportAttributes.includes(attribute.key)) return false;
  }
  return true;
}
function continueLoading(
  state: GraphLoadingState,
  completion: ModuleCompletion,
  sourcePhase: boolean = false,
): void {
  if (!state.isLoading) return;
  if (!completion.ok) {
    state.isLoading = false;
    state.capability.functions.reject(completion.error);
    return;
  }
  innerLoading(completion.module, state, sourcePhase);
}
function innerLoading(
  module: ModuleRecord,
  state: GraphLoadingState,
  sourcePhase: boolean = false,
): void {
  if (module.kind !== "module") throw "MODULE_KIND_INVARIANT";
  if (
    !sourcePhase &&
    module.status === "new" &&
    !state.visited.includes(module)
  ) {
    state.visited.push(module);
    state.pendingModulesCount += module.shape.requests.length;
    for (let index = 0; index < module.shape.requests.length; index++) {
      const request = module.shape.requests[index];
      if (request === undefined) throw "MODULE_REQUEST_INVARIANT";
      const active = module.realm.agent.activeContext,
        realm = active === undefined ? module.realm : active.realm;
      if (!allImportAttributesSupported(realm, request.attributes))
        continueLoading(state, {
          ok: false,
          error: createRuntimeError(realm, "syntax"),
        });
      else {
        const loaded = module.loaded[index];
        if (loaded !== undefined)
          continueLoading(
            state,
            { ok: true, module: loaded },
            request.phase === "source",
          );
        else {
          const loader = module.realm.moduleLoader;
          if (loader === undefined) rejectUnsupportedExecution(realm);
          loader(module, request, state.hostDefined, state);
        }
      }
      if (!state.isLoading) return;
    }
  }
  state.pendingModulesCount--;
  if (state.pendingModulesCount === 0) {
    state.isLoading = false;
    for (const visited of state.visited) {
      if (visited === undefined) throw "MODULE_LOADING_STATUS_INVARIANT";
      // Another overlapping graph can finish, link and evaluate this module
      // before our final host response arrives. Never roll its status back.
      if (visited.status === "new") visited.status = "unlinked";
    }
    state.capability.functions.resolve(undefined);
  }
}
export function loadRequestedModules(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
  hostDefined: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const active = module.realm.agent.activeContext,
    realm = active === undefined ? module.realm : active.realm;
  const capability = createModuleCapability(realm, hooks);
  const state: GraphLoadingState = {
    kind: "graph",
    capability,
    isLoading: true,
    pendingModulesCount: 1,
    visited: [],
    hostDefined,
  };
  innerLoading(module, state);
  return capability.promise;
}
export function finishLoadingImportedModule(
  referrer: ModuleReferrer,
  request: ModuleRequest,
  payload: ModuleLoadPayload,
  completion: ModuleCompletion,
): void {
  if (payload.kind === "dynamic") {
    if (payload.finished) throw "MODULE_DYNAMIC_PAYLOAD_INVARIANT";
    payload.finished = true;
    if (completion.ok) recordLoadedModule(referrer, request, completion.module);
    continueDynamicImport(referrer.realm, payload, completion);
    return;
  }
  if (referrer.kind !== "module") throw "MODULE_REQUEST_INVARIANT";
  let known = false;
  for (const candidate of referrer.shape.requests) {
    if (candidate === undefined) throw "MODULE_REQUEST_INVARIANT";
    if (moduleRequestsEqual(request, candidate)) known = true;
  }
  if (!known) throw "MODULE_REQUEST_INVARIANT";
  if (completion.ok) recordLoadedModule(referrer, request, completion.module);
  continueLoading(payload, completion, request.phase === "source");
}
