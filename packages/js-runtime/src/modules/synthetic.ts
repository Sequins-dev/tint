import {
  createMutableBinding,
  initializeBinding,
  setMutableBinding,
  type DeclarativeEnvironment,
} from "../environments/records/index.ts";
import type { ErrorRealm } from "../objects/errors.ts";
import {
  createSyntheticModuleRecord,
  type ModuleRecord,
  type SourceModuleShape,
} from "./records.ts";

/** Synthetic modules have fixed exports and no static dependencies. Their live
 * cells remain stable across linking, including imports already sharing them. */
export function createSyntheticModule(
  realm: ErrorRealm,
  exportNames: readonly string[],
  evaluate: (module: ModuleRecord) => void,
  hostDefined: unknown,
): ModuleRecord {
  const names: string[] = [],
    seen = new Set<string>();
  for (const name of exportNames) {
    if (name === undefined || seen.has(name))
      throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
    seen.add(name);
    names.push(name);
  }
  const shape: SourceModuleShape = {
    requests: [],
    imports: [],
    localExports: names.map((name) => ({ exportName: name, localName: name })),
    indirectExports: [],
    starExports: [],
    hasTopLevelAwait: false,
  };
  const state: {
    environment: DeclarativeEnvironment<unknown> | undefined;
    module: ModuleRecord | undefined;
  } = { environment: undefined, module: undefined };
  const module = createSyntheticModuleRecord(
    realm,
    shape,
    hostDefined,
    (environment) => {
      state.environment = environment;
      for (const name of names) {
        if (name === undefined) throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
        createMutableBinding<unknown>(environment, name, false);
      }
    },
    () => {
      const environment = state.environment;
      if (environment === undefined) throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
      for (const name of names) {
        if (name === undefined) throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
        const binding = environment.bindings.get(name);
        if (binding === undefined) throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
        if (binding.initialized) {
          if (
            setMutableBinding<unknown>(environment, name, undefined, true) !==
            "none"
          )
            throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
        } else initializeBinding<unknown>(environment, name, undefined);
      }
    },
    () => {
      const current = state.module;
      if (current === undefined) throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
      evaluate(current);
    },
  );
  state.module = module;
  return module;
}

export function setSyntheticModuleExport(
  module: ModuleRecord,
  name: string,
  value: unknown,
): void {
  if (
    !module.synthetic ||
    !module.environmentInitialized ||
    !module.shape.localExports.some(
      (entry) => entry !== undefined && entry.exportName === name,
    ) ||
    setMutableBinding<unknown>(module.environment, name, value, true) !== "none"
  )
    throw "MODULE_SYNTHETIC_EXPORT_INVARIANT";
}
