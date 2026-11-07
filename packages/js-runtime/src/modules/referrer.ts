import {
  moduleRequestKeysEqual,
  type ModuleRequest,
} from "@tint/foundation/modules";
import {
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "../objects/errors.ts";
import type { LoadedModuleRequest } from "./records.ts";
import type { ScriptRecord } from "../objects/jobs.ts";
import type { ModuleRecord } from "./records.ts";

/** Bound by the image compiler to an exact ModuleRecord descriptor check. */
export function viewModuleRecord(value: unknown): ModuleRecord | undefined {
  throw "UNBOUND_MODULE_RECORD_VIEW";
}

/** Bound by the image compiler to an exact ScriptRecord descriptor check. */
export function viewScriptRecord(value: unknown): ScriptRecord | undefined {
  throw "UNBOUND_SCRIPT_RECORD_VIEW";
}

export type { LoadedModuleRequest } from "./records.ts";
export interface RealmReferrer {
  readonly kind: "realm";
  readonly realm: ErrorRealm;
  readonly loadedRequests: LoadedModuleRequest[];
}
export type ModuleReferrer = ModuleRecord | ScriptRecord | RealmReferrer;

export function realmReferrer(realm: ErrorRealm): RealmReferrer {
  const cached = realm.realmReferrer;
  if (cached !== undefined) return cached;
  const referrer: RealmReferrer = { kind: "realm", realm, loadedRequests: [] };
  realm.realmReferrer = referrer;
  return referrer;
}

export function activeModuleReferrer(realm: ErrorRealm): ModuleReferrer {
  const active = realm.agent.activeContext;
  const current = active === undefined ? realm : active.realm;
  if (active === undefined || active.scriptOrModule === undefined)
    return realmReferrer(current);
  const module = viewModuleRecord(active.scriptOrModule);
  if (module !== undefined) return module;
  const script = viewScriptRecord(active.scriptOrModule);
  if (script !== undefined) return script;
  return rejectUnsupportedExecution(current);
}

/** Successful loads alone enter the referrer's identity cache. Static edges
 * retain their indexed storage; dynamic edges never become linking edges. */
export function recordLoadedModule(
  referrer: ModuleReferrer,
  request: ModuleRequest,
  module: ModuleRecord,
): void {
  let staticRequest = false;
  if (referrer.kind === "module") {
    for (let index = 0; index < referrer.shape.requests.length; index++) {
      const known = referrer.shape.requests[index];
      if (known === undefined) throw "MODULE_REQUEST_INVARIANT";
      if (!moduleRequestKeysEqual(known, request)) continue;
      staticRequest = true;
      const previous = referrer.loaded[index];
      if (previous !== undefined && previous !== module)
        throw "MODULE_LOAD_IDENTITY_INVARIANT";
    }
  }
  let dynamicRequest = false;
  for (const loaded of referrer.loadedRequests) {
    if (loaded === undefined) throw "MODULE_REQUEST_INVARIANT";
    if (!moduleRequestKeysEqual(loaded.request, request)) continue;
    if (loaded.module !== module) throw "MODULE_LOAD_IDENTITY_INVARIANT";
    dynamicRequest = true;
  }
  if (referrer.kind === "module" && staticRequest) {
    for (let index = 0; index < referrer.shape.requests.length; index++) {
      const known = referrer.shape.requests[index];
      if (known === undefined) throw "MODULE_REQUEST_INVARIANT";
      if (moduleRequestKeysEqual(known, request))
        referrer.loaded[index] = module;
    }
    return;
  }
  if (dynamicRequest) return;
  referrer.loadedRequests.push({ request, module });
}
