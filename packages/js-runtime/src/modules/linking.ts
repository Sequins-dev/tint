import {
  createImportBinding,
  createImmutableBinding,
  initializeBinding,
} from "../environments/records/index.ts";
import { createRuntimeError } from "../objects/errors.ts";
import { runScriptContext } from "../objects/jobs.ts";
import {
  loadedModule,
  getModuleSource,
  moduleExecutionContext,
  type ModuleRecord,
} from "./records.ts";
import { resolveExport, type ResolvedBinding } from "./resolve.ts";
import { getModuleNamespace } from "./namespace.ts";
export type ModuleLinkResult =
  { readonly ok: true } | { readonly ok: false; readonly error: unknown };
type InnerLinkResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly error: unknown };
interface LinkStack {
  readonly modules: ModuleRecord[];
  depth: number;
}
interface ImportBindingPlan {
  readonly name: string;
  readonly resolution: ResolvedBinding;
  readonly sourceValue: unknown;
}
function syntaxFailure(module: ModuleRecord): ModuleLinkResult {
  const active = module.realm.agent.activeContext;
  return {
    ok: false,
    error: createRuntimeError(
      active === undefined ? module.realm : active.realm,
      "syntax",
    ),
  };
}
function initializeEnvironment(module: ModuleRecord): ModuleLinkResult {
  // A failed ancestor can leave this environment committed. Loaded identities
  // and export resolution are stable, and no module body has executed yet.
  if (module.environmentInitialized) return { ok: true };
  for (const entry of module.shape.indirectExports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    const resolved = resolveExport(module, entry.exportName);
    if (resolved === undefined || typeof resolved === "string")
      return syntaxFailure(module);
  }
  const imports: ImportBindingPlan[] = [];
  for (const entry of module.shape.imports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    const target = loadedModule(module, entry.request);
    let resolution: ResolvedBinding;
    if (module.shape.requests[entry.request]?.phase === "source")
      resolution = { module: target, bindingName: undefined, source: true };
    else if (entry.importName === undefined) {
      if (module.shape.requests[entry.request]?.phase === "defer")
        resolution = { module: target, bindingName: undefined, deferred: true };
      else resolution = { module: target, bindingName: undefined };
    } else {
      const resolved = resolveExport(target, entry.importName);
      if (resolved === undefined || typeof resolved === "string")
        return syntaxFailure(module);
      resolution = resolved;
    }
    if (resolution.source && resolution.module.moduleSource === undefined)
      return syntaxFailure(module);
    const plan: ImportBindingPlan = {
      name: entry.localName,
      resolution,
      sourceValue: resolution.source
        ? getModuleSource(resolution.module)
        : undefined,
    };
    imports.push(plan);
  }
  // All observable resolution failures precede mutation of this environment.
  for (const entry of imports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    const resolution = entry.resolution;
    if (resolution.bindingName === undefined) {
      let namespace: unknown;
      if (resolution.source) namespace = entry.sourceValue;
      else
        namespace = getModuleNamespace(
          resolution.module,
          resolution.deferred ? "defer" : undefined,
        );
      createImmutableBinding<unknown>(module.environment, entry.name, true);
      initializeBinding<unknown>(module.environment, entry.name, namespace);
    } else
      createImportBinding<unknown>(
        module.environment,
        entry.name,
        resolution.module.environment,
        resolution.bindingName,
      );
  }
  runScriptContext<void>(
    module.realm.agent,
    moduleExecutionContext(module),
    module.instantiate,
  );
  module.environmentInitialized = true;
  return { ok: true };
}
function innerLink(
  module: ModuleRecord,
  stack: LinkStack,
  index: number,
): InnerLinkResult {
  if (module.kind !== "module") throw "MODULE_KIND_INVARIANT";
  if (module.synthetic) {
    if (module.status === "new") throw "MODULE_STATUS_INVARIANT";
    module.instantiate();
    module.environmentInitialized = true;
    module.status = "linked";
    return { ok: true, index };
  }
  if (
    module.status === "linking" ||
    module.status === "linked" ||
    module.status === "evaluating-async" ||
    module.status === "evaluated"
  )
    return { ok: true, index };
  if (module.status !== "unlinked") throw "MODULE_STATUS_INVARIANT";
  module.status = "linking";
  module.dfsIndex = index;
  module.dfsAncestorIndex = index;
  index++;
  if (stack.depth === stack.modules.length) stack.modules.push(module);
  else stack.modules[stack.depth] = module;
  stack.depth++;
  for (let request = 0; request < module.shape.requests.length; request++) {
    if (module.shape.requests[request]?.phase === "source") continue;
    const dependency = loadedModule(module, request),
      linked = innerLink(dependency, stack, index);
    if (!linked.ok) return { ok: false, error: linked.error };
    index = linked.index;
    if (dependency.status === "linking")
      module.dfsAncestorIndex = Math.min(
        module.dfsAncestorIndex,
        dependency.dfsAncestorIndex,
      );
  }
  const initialized = initializeEnvironment(module);
  if (!initialized.ok) return { ok: false, error: initialized.error };
  if (module.dfsAncestorIndex === module.dfsIndex) {
    for (;;) {
      if (stack.depth === 0) throw "MODULE_STACK_INVARIANT";
      stack.depth--;
      const member = stack.modules[stack.depth];
      if (member === undefined || member.status !== "linking")
        throw "MODULE_STACK_INVARIANT";
      member.status = "linked";
      if (member === module) break;
    }
  }
  return { ok: true, index };
}
function resetActiveStack(stack: LinkStack): void {
  for (let index = 0; index < stack.depth; index++) {
    const module = stack.modules[index];
    if (module === undefined || module.status !== "linking")
      throw "MODULE_STACK_INVARIANT";
    module.status = "unlinked";
  }
  stack.depth = 0;
}
/** Link source graphs and dependency-free synthetic modules without executing bodies. Semantic SyntaxErrors
 * are typed results; broken host/model invariants remain thrown faults. */
export function linkModule(module: ModuleRecord): ModuleLinkResult {
  if (module.kind !== "module") throw "MODULE_KIND_INVARIANT";
  if (
    module.status !== "unlinked" &&
    module.status !== "linked" &&
    module.status !== "evaluating-async" &&
    module.status !== "evaluated"
  )
    throw "MODULE_STATUS_INVARIANT";
  const stack: LinkStack = { modules: [], depth: 0 };
  try {
    const result = innerLink(module, stack, 0);
    if (!result.ok) {
      resetActiveStack(stack);
      return { ok: false, error: result.error };
    }
    if (stack.depth !== 0) throw "MODULE_STACK_INVARIANT";
    return { ok: true };
  } catch (error) {
    resetActiveStack(stack);
    throw error;
  }
}
