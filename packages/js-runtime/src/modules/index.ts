export {
  createSourceTextModule,
  loadedModule,
  getModuleSource,
  type ModuleRequest,
  type ImportEntry,
  type LocalExportEntry,
  type IndirectExportEntry,
  type SourceModuleShape,
  type ModuleStatus,
  type ModuleRecord,
} from "./records.ts";
export {
  getExportedNames,
  resolveExport,
  type ResolvedBinding,
  type ExportResolution,
} from "./resolve.ts";
export { getModuleNamespace } from "./namespace.ts";
export { linkModule, type ModuleLinkResult } from "./linking.ts";

export {
  loadRequestedModules,
  finishLoadingImportedModule,
  type ModuleCapability,
  type ModuleCompletion,
  type ModuleLoader,
  type GraphLoadingState,
  type ModuleLoadPayload,
  type DynamicImportState,
} from "./loading.ts";
export {
  evaluateModule,
  evaluateModuleSync,
  readyForSyncExecution,
  gatherAsynchronousDependencies,
  settledModulePromise,
  type HostModuleOutcome,
} from "./evaluation.ts";

export {
  canonicalModuleRequest,
  moduleRequestsEqual,
  moduleRequestKeysEqual,
} from "@tint/foundation/modules";

export {
  createLoweredSourceModule,
  createLoweredAsyncSourceModule,
  type SourceModuleDeclarations,
} from "./source.ts";

export { getImportMeta, getActiveImportMeta } from "./import-meta.ts";

export {
  viewModuleRecord,
  viewScriptRecord,
  realmReferrer,
  activeModuleReferrer,
  type RealmReferrer,
  type ModuleReferrer,
  type LoadedModuleRequest,
} from "./referrer.ts";

export { evaluateImportCall } from "./dynamic-import.ts";

export {
  createSyntheticModule,
  setSyntheticModuleExport,
} from "./synthetic.ts";

export { parseJSONModule } from "./json.ts";
