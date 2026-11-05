import type { ErrorRealm } from "../objects/errors.ts";
import { viewModuleRecord } from "./referrer.ts";
import { createObject, type OrdinaryObject } from "../objects/operations.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";
import type { ModuleRecord } from "./records.ts";

/** Default host policy supplies no properties and performs no finalization. */
export function getImportMeta(
  module: ModuleRecord,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const cached = module.importMeta;
  if (cached !== undefined) return cached;
  const meta = createObject<ScriptPropertyKey, unknown>(undefined);
  module.importMeta = meta;
  return meta;
}

/** ImportMeta is only emitted in module code, including its nested functions. */
export function getActiveImportMeta(
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const active = realm.agent.activeContext;
  if (active === undefined) throw "IMPORT_META_REFERRER_INVARIANT";
  const module = viewModuleRecord(active.scriptOrModule);
  if (module === undefined) throw "IMPORT_META_REFERRER_INVARIANT";
  return getImportMeta(module);
}
