import type {
  SourceModuleShape,
  ModuleRequest,
} from "@tint/foundation/modules";
export type {
  ModuleRequest,
  ImportEntry,
  LocalExportEntry,
  IndirectExportEntry,
  SourceModuleShape,
} from "@tint/foundation/modules";
import type { ModuleCapability } from "./loading.ts";
import {
  createDeclarativeEnvironment,
  type DeclarativeEnvironment,
} from "../environments/records/index.ts";
import { createRuntimeError, type ErrorRealm } from "../objects/errors.ts";
import type { OrdinaryObject } from "../objects/operations.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";

export interface LoadedModuleRequest {
  readonly request: ModuleRequest;
  readonly module: ModuleRecord;
}
export type ModuleStatus =
  | "new"
  | "unlinked"
  | "linking"
  | "linked"
  | "evaluating"
  | "evaluating-async"
  | "evaluated";
export interface ModuleRecord {
  readonly kind: "module";
  readonly synthetic: boolean;
  readonly realm: ErrorRealm;
  readonly hostDefined: unknown;
  readonly shape: SourceModuleShape;
  /** Embedding-provided source representation; ordinary JavaScript has none. */
  moduleSource: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly environment: DeclarativeEnvironment<unknown>;
  readonly loaded: (ModuleRecord | undefined)[];
  readonly loadedRequests: LoadedModuleRequest[];
  readonly instantiate: () => void;
  readonly execute: () => void;
  readonly executeAsync: ((capability: ModuleCapability) => void) | undefined;
  readonly asyncParents: ModuleRecord[];
  asyncEvaluationOrder: number | "done" | undefined;
  pendingAsyncDependencies: number;
  evaluationError: { readonly error: unknown } | undefined;
  /** Embedding completion-contract fault; separate from arbitrary JS throws. */
  executionFault: { readonly error: unknown } | undefined;
  cycleRoot: ModuleRecord | undefined;
  topLevelCapability: ModuleCapability | undefined;
  status: ModuleStatus;
  dfsIndex: number;
  dfsAncestorIndex: number;
  environmentInitialized: boolean;
  namespace: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  deferredNamespace: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  importMeta: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
}
/** Allocate local cells before linking, so cyclic imports can share their identity.
 * Declaration callbacks must only create cells; link-time initialization is separate. */
export function createSourceTextModule(
  realm: ErrorRealm,
  shape: SourceModuleShape,
  hostDefined: unknown,
  declare: (environment: DeclarativeEnvironment<unknown>) => void,
  instantiate: () => void,
  execute: () => void,
  executeAsync?: (capability: ModuleCapability) => void,
): ModuleRecord {
  return createModuleRecord(
    realm,
    shape,
    hostDefined,
    declare,
    instantiate,
    execute,
    executeAsync,
    false,
  );
}

/** Internal non-cyclic record factory; public synthetic construction owns exports. */
export function createSyntheticModuleRecord(
  realm: ErrorRealm,
  shape: SourceModuleShape,
  hostDefined: unknown,
  declare: (environment: DeclarativeEnvironment<unknown>) => void,
  instantiate: () => void,
  execute: () => void,
): ModuleRecord {
  if (
    shape.requests.length !== 0 ||
    shape.imports.length !== 0 ||
    shape.indirectExports.length !== 0 ||
    shape.starExports.length !== 0 ||
    shape.hasTopLevelAwait
  )
    throw "MODULE_SYNTHETIC_SHAPE_INVARIANT";
  return createModuleRecord(
    realm,
    shape,
    hostDefined,
    declare,
    instantiate,
    execute,
    undefined,
    true,
  );
}

function createModuleRecord(
  realm: ErrorRealm,
  shape: SourceModuleShape,
  hostDefined: unknown,
  declare: (environment: DeclarativeEnvironment<unknown>) => void,
  instantiate: () => void,
  execute: () => void,
  executeAsync: ((capability: ModuleCapability) => void) | undefined,
  synthetic: boolean,
): ModuleRecord {
  // ParseModule normalizes every re-exported import, including namespaces,
  // into an indirect entry. Only actual local declarations own shared cells.
  const importedNames = new Set<string>();
  for (const entry of shape.imports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    importedNames.add(entry.localName);
  }
  for (const entry of shape.localExports) {
    if (entry === undefined || importedNames.has(entry.localName))
      throw "MODULE_SHAPE_INVARIANT";
  }
  const environment = createDeclarativeEnvironment<unknown>(undefined);
  declare(environment);
  const loaded: (ModuleRecord | undefined)[] = [];
  for (let index = 0; index < shape.requests.length; index++)
    loaded.push(undefined);
  return {
    kind: "module",
    synthetic,
    realm,
    hostDefined,
    shape,
    moduleSource: undefined,
    environment,
    loaded,
    loadedRequests: [],
    instantiate,
    execute,
    executeAsync,
    asyncParents: [],
    asyncEvaluationOrder: undefined,
    pendingAsyncDependencies: 0,
    evaluationError: undefined,
    executionFault: undefined,
    cycleRoot: undefined,
    topLevelCapability: undefined,
    status: "new",
    dfsIndex: -1,
    dfsAncestorIndex: -1,
    environmentInitialized: false,
    namespace: undefined,
    deferredNamespace: undefined,
    importMeta: undefined,
  };
}

export function loadedModule(
  module: ModuleRecord,
  request: number,
): ModuleRecord {
  if (module.status === "new") throw "MODULE_LOADED_INVARIANT";
  const target = module.loaded[request];
  if (
    target === undefined ||
    (target.status === "new" &&
      module.shape.requests[request]?.phase !== "source")
  )
    throw "MODULE_LOADED_INVARIANT";
  return target;
}

export function getModuleSource(
  module: ModuleRecord,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const source = module.moduleSource;
  if (source !== undefined) return source;
  const active = module.realm.agent.activeContext;
  throw createRuntimeError(
    active === undefined ? module.realm : active.realm,
    "syntax",
  );
}
