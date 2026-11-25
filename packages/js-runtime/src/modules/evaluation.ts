import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "../objects/errors.ts";
import { runScriptContext } from "../objects/jobs.ts";
import { builtinFunction } from "../objects/intrinsics.ts";
import { createScriptPromiseHooks } from "../objects/promises.ts";
import { performPromiseThen } from "../promises/index.ts";
import {
  exoticSlots,
  type ObjectHooks,
  type OrdinaryObject,
} from "../objects/operations.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";
import { createModuleCapability } from "./loading.ts";
import {
  loadedModule,
  moduleExecutionContext,
  type ModuleRecord,
} from "./records.ts";
interface EvaluationStack {
  readonly modules: ModuleRecord[];
  depth: number;
}

function moduleSCCEvaluated(module: ModuleRecord): boolean {
  const root = module.cycleRoot;
  return root === undefined
    ? module.status === "evaluated"
    : root.status === "evaluated";
}

/** Deferred access checks the entire graph before executing any synchronous body. */
export function readyForSyncExecution(
  module: ModuleRecord,
  seen: ModuleRecord[] = [],
): boolean {
  if (module.synthetic || seen.includes(module)) return true;
  seen.push(module);
  if (moduleSCCEvaluated(module)) return true;
  if (module.status === "evaluating" || module.status === "evaluating-async")
    return false;
  if (module.status !== "linked" && module.status !== "evaluated")
    throw "MODULE_SYNC_STATUS_INVARIANT";
  if (module.shape.hasTopLevelAwait) return false;
  for (let index = 0; index < module.shape.requests.length; index++) {
    if (module.shape.requests[index]?.phase === "source") continue;
    if (!readyForSyncExecution(loadedModule(module, index), seen)) return false;
  }
  return true;
}

export function evaluateModuleSync(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
): void {
  const active = module.realm.agent.activeContext,
    realm = active === undefined ? module.realm : active.realm;
  if (!readyForSyncExecution(module)) throw createRuntimeError(realm, "type");
  const outcome = settledModulePromise(evaluateModule(module, hooks), realm);
  if (outcome.kind === "pending") throw "MODULE_SYNC_PENDING_INVARIANT";
  if (outcome.kind === "rejected") throw outcome.error;
}

/** Post-order collection stops at each unexecuted TLA module, across deferred edges too. */
export function gatherAsynchronousDependencies(
  module: ModuleRecord,
  seen: ModuleRecord[] = [],
): ModuleRecord[] {
  if (seen.includes(module)) return [];
  seen.push(module);
  if (
    module.synthetic ||
    module.status === "evaluating" ||
    moduleSCCEvaluated(module)
  )
    return [];
  if (module.shape.hasTopLevelAwait) return [module];
  const result: ModuleRecord[] = [];
  for (let index = 0; index < module.shape.requests.length; index++) {
    if (module.shape.requests[index]?.phase === "source") continue;
    for (const dependency of gatherAsynchronousDependencies(
      loadedModule(module, index),
      seen,
    )) {
      if (dependency === undefined) throw "MODULE_EVALUATION_INVARIANT";
      if (!result.includes(dependency)) result.push(dependency);
    }
  }
  return result;
}
type EvaluationResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly error: unknown };
function preflight(module: ModuleRecord, visited: ModuleRecord[]): void {
  if (module.kind !== "module") throw "MODULE_KIND_INVARIANT";
  if (visited.includes(module) || module.status === "evaluated") return;
  if (module.status !== "linked" && module.status !== "evaluating-async")
    throw "MODULE_EVALUATE_INVARIANT";
  visited.push(module);
  // Older producers have no suspension entry. Reject their complete graph
  // before running any body rather than executing a partial asynchronous graph.
  if (module.shape.hasTopLevelAwait && module.executeAsync === undefined) {
    const active = module.realm.agent.activeContext;
    rejectUnsupportedExecution(
      active === undefined ? module.realm : active.realm,
    );
  }
  for (let request = 0; request < module.shape.requests.length; request++)
    if (module.shape.requests[request]?.phase !== "source")
      preflight(loadedModule(module, request), visited);
}
function runSynchronousBody(
  module: ModuleRecord,
): { readonly error: unknown } | undefined {
  try {
    runScriptContext<void>(
      module.realm.agent,
      moduleExecutionContext(module),
      module.execute,
    );
    return undefined;
  } catch (error) {
    const fault = module.executionFault;
    if (fault !== undefined) throw fault.error;
    return { error };
  }
}
function completeAsync(module: ModuleRecord): void {
  module.asyncEvaluationOrder = "done";
  module.status = "evaluated";
  const capability = module.topLevelCapability;
  if (capability !== undefined) capability.functions.resolve(undefined);
}
function rejectAsync(module: ModuleRecord, error: unknown): void {
  if (module.status === "evaluated") {
    if (module.evaluationError === undefined)
      throw "MODULE_ASYNC_STATUS_INVARIANT";
    return;
  }
  if (
    module.status !== "evaluating-async" ||
    typeof module.asyncEvaluationOrder !== "number"
  )
    throw "MODULE_ASYNC_STATUS_INVARIANT";
  module.evaluationError = { error };
  module.status = "evaluated";
  module.asyncEvaluationOrder = "done";
  const capability = module.topLevelCapability;
  if (capability !== undefined) capability.functions.reject(error);
  for (const parent of module.asyncParents) {
    if (parent === undefined) throw "MODULE_ASYNC_PARENT_INVARIANT";
    rejectAsync(parent, error);
  }
}
function gatherAvailable(
  module: ModuleRecord,
  available: ModuleRecord[],
): void {
  for (const parent of module.asyncParents) {
    if (parent === undefined) throw "MODULE_ASYNC_PARENT_INVARIANT";
    const root = parent.cycleRoot;
    if (root === undefined) throw "MODULE_ASYNC_CYCLE_INVARIANT";
    if (available.includes(parent) || root.evaluationError !== undefined)
      continue;
    if (
      parent.status !== "evaluating-async" ||
      parent.pendingAsyncDependencies <= 0
    )
      throw "MODULE_ASYNC_DEPENDENCY_INVARIANT";
    parent.pendingAsyncDependencies--;
    if (parent.pendingAsyncDependencies === 0) {
      available.push(parent);
      if (!parent.shape.hasTopLevelAwait) gatherAvailable(parent, available);
    }
  }
}
function asyncOrder(module: ModuleRecord): number {
  const order = module.asyncEvaluationOrder;
  if (typeof order !== "number") throw "MODULE_ASYNC_ORDER_INVARIANT";
  return order;
}
function fulfillAsync(module: ModuleRecord, hooks: ObjectHooks<unknown>): void {
  if (module.status === "evaluated") {
    if (module.evaluationError === undefined)
      throw "MODULE_ASYNC_STATUS_INVARIANT";
    return;
  }
  if (
    module.status !== "evaluating-async" ||
    typeof module.asyncEvaluationOrder !== "number"
  )
    throw "MODULE_ASYNC_STATUS_INVARIANT";
  completeAsync(module);
  const available: ModuleRecord[] = [];
  gatherAvailable(module, available);
  // Stable insertion order avoids depending on an embedding's Array.sort.
  for (let index = 1; index < available.length; index++) {
    const candidate = available[index];
    if (candidate === undefined) throw "MODULE_ASYNC_PARENT_INVARIANT";
    let position = index;
    while (position > 0) {
      const previous = available[position - 1];
      if (previous === undefined) throw "MODULE_ASYNC_PARENT_INVARIANT";
      if (asyncOrder(previous) <= asyncOrder(candidate)) break;
      available[position] = previous;
      position--;
    }
    available[position] = candidate;
  }
  for (const parent of available) {
    if (parent === undefined) throw "MODULE_ASYNC_PARENT_INVARIANT";
    if (parent.status === "evaluated") {
      if (parent.evaluationError === undefined)
        throw "MODULE_ASYNC_STATUS_INVARIANT";
    } else if (parent.shape.hasTopLevelAwait) executeAsync(parent, hooks);
    else {
      const failure = runSynchronousBody(parent);
      if (failure !== undefined) rejectAsync(parent, failure.error);
      else completeAsync(parent);
    }
  }
}
function executeAsync(module: ModuleRecord, hooks: ObjectHooks<unknown>): void {
  const execute = module.executeAsync;
  if (execute === undefined || !module.shape.hasTopLevelAwait)
    throw "MODULE_ASYNC_ENTRY_INVARIANT";
  const active = module.realm.agent.activeContext,
    realm = active === undefined ? module.realm : active.realm,
    capability = createModuleCapability(realm, hooks),
    record = exoticSlots(capability.promise).internalPromiseData;
  if (record === undefined) throw "MODULE_PROMISE_INVARIANT";
  const fulfilled = builtinFunction(
    realm.functionPrototype,
    "",
    0,
    (_receiver, _args): unknown => {
      try {
        fulfillAsync(module, hooks);
      } catch (error) {
        module.executionFault = { error };
        throw error;
      }
      return undefined;
    },
    hooks,
  );
  const rejected = builtinFunction(
    realm.functionPrototype,
    "",
    1,
    (_receiver, args): unknown => {
      try {
        rejectAsync(module, args[0]);
      } catch (error) {
        module.executionFault = { error };
        throw error;
      }
      return undefined;
    },
    hooks,
  );
  const protocol = createScriptPromiseHooks(
    realm,
    hooks,
    (promise, operation): void =>
      realm.promiseRejectionTracker(promise, operation),
  );
  performPromiseThen<unknown>(record, fulfilled, rejected, undefined, protocol);
  // ExecuteModule(capability) reports JS completion through the capability.
  // A synchronous throw here is an embedding invariant, never a JS rejection.
  runScriptContext<void>(
    module.realm.agent,
    moduleExecutionContext(module),
    (): void => execute(capability),
  );
}
/** Non-cyclic evaluation has no cached capability or SCC state. Every call
 * executes the specification-defined steps and returns a fresh settled promise. */
function evaluateSynthetic(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (!module.environmentInitialized) throw "MODULE_EVALUATE_INVARIANT";
  const active = module.realm.agent.activeContext,
    realm = active === undefined ? module.realm : active.realm,
    capability = createModuleCapability(realm, hooks);
  const failure = runSynchronousBody(module);
  module.status = "evaluated";
  if (failure === undefined) capability.functions.resolve(undefined);
  else capability.functions.reject(failure.error);
  return capability.promise;
}

function innerEvaluation(
  module: ModuleRecord,
  stack: EvaluationStack,
  index: number,
  hooks: ObjectHooks<unknown>,
): EvaluationResult {
  if (module.kind !== "module") throw "MODULE_KIND_INVARIANT";
  if (module.status === "evaluated" || module.status === "evaluating-async") {
    const failure = module.evaluationError;
    return failure === undefined
      ? { ok: true, index }
      : { ok: false, error: failure.error };
  }
  if (module.status === "evaluating") return { ok: true, index };
  if (module.status !== "linked") throw "MODULE_EVALUATE_INVARIANT";
  module.status = "evaluating";
  module.dfsIndex = index;
  module.dfsAncestorIndex = index;
  module.pendingAsyncDependencies = 0;
  index++;
  stack.modules[stack.depth] = module;
  stack.depth++;
  const evaluationList: ModuleRecord[] = [];
  for (let request = 0; request < module.shape.requests.length; request++) {
    if (module.shape.requests[request]?.phase === "source") continue;
    const dependency = loadedModule(module, request);
    if (module.shape.requests[request]?.phase === "defer") {
      for (const asynchronous of gatherAsynchronousDependencies(dependency)) {
        if (asynchronous === undefined) throw "MODULE_EVALUATION_INVARIANT";
        if (!evaluationList.includes(asynchronous))
          evaluationList.push(asynchronous);
      }
    } else if (!evaluationList.includes(dependency))
      evaluationList.push(dependency);
  }
  for (const required of evaluationList) {
    if (required === undefined) throw "MODULE_EVALUATION_INVARIANT";
    let dependency = required;
    if (dependency.synthetic) {
      const active = dependency.realm.agent.activeContext,
        realm = active === undefined ? dependency.realm : active.realm;
      const outcome = settledModulePromise(
        evaluateSynthetic(dependency, hooks),
        realm,
      );
      if (outcome.kind === "pending")
        throw "MODULE_SYNTHETIC_PENDING_INVARIANT";
      if (outcome.kind === "rejected")
        return { ok: false, error: outcome.error };
      continue;
    }
    const result = innerEvaluation(dependency, stack, index, hooks);
    if (!result.ok) return result;
    index = result.index;
    if (dependency.status === "evaluating") {
      if (dependency.dfsAncestorIndex < module.dfsAncestorIndex)
        module.dfsAncestorIndex = dependency.dfsAncestorIndex;
    } else {
      const root = dependency.cycleRoot;
      if (root === undefined) throw "MODULE_EVALUATION_CYCLE_INVARIANT";
      dependency = root;
      const failure = dependency.evaluationError;
      if (failure !== undefined) return { ok: false, error: failure.error };
    }
    if (typeof dependency.asyncEvaluationOrder === "number") {
      module.pendingAsyncDependencies++;
      dependency.asyncParents.push(module);
    }
  }
  if (module.shape.hasTopLevelAwait || module.pendingAsyncDependencies > 0) {
    module.asyncEvaluationOrder = module.realm.agent
      .moduleAsyncEvaluationCount++;
    if (module.pendingAsyncDependencies === 0) executeAsync(module, hooks);
  } else {
    const failure = runSynchronousBody(module);
    if (failure !== undefined) return { ok: false, error: failure.error };
  }
  if (module.dfsIndex === module.dfsAncestorIndex) {
    let done = false;
    while (!done) {
      if (stack.depth === 0) throw "MODULE_EVALUATION_STACK_INVARIANT";
      stack.depth--;
      const member = stack.modules[stack.depth];
      if (member === undefined) throw "MODULE_EVALUATION_STACK_INVARIANT";
      member.status =
        member.asyncEvaluationOrder === undefined
          ? "evaluated"
          : "evaluating-async";
      member.cycleRoot = module;
      done = member === module;
    }
  }
  return { ok: true, index };
}
export function evaluateModule(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (
    module.status !== "linked" &&
    module.status !== "evaluating-async" &&
    module.status !== "evaluated"
  )
    throw "MODULE_EVALUATE_INVARIANT";
  if (module.synthetic) return evaluateSynthetic(module, hooks);
  const root = module.cycleRoot;
  if (root !== undefined) module = root;
  const existing = module.topLevelCapability;
  if (existing !== undefined) return existing.promise;
  preflight(module, []);
  const active = module.realm.agent.activeContext,
    realm = active === undefined ? module.realm : active.realm,
    capability = createModuleCapability(realm, hooks);
  module.topLevelCapability = capability;
  const stack: EvaluationStack = { modules: [], depth: 0 },
    result = innerEvaluation(module, stack, 0, hooks);
  if (!result.ok) {
    for (let index = 0; index < stack.depth; index++) {
      const member = stack.modules[index];
      if (member === undefined) throw "MODULE_EVALUATION_STACK_INVARIANT";
      member.status = "evaluated";
      member.evaluationError = { error: result.error };
    }
    capability.functions.reject(result.error);
  } else if (module.status === "evaluated")
    capability.functions.resolve(undefined);
  return capability.promise;
}
export type HostModuleOutcome =
  | { readonly kind: "fulfilled" }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "pending" };
export function settledModulePromise(
  promise: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): HostModuleOutcome {
  const record = exoticSlots(promise).internalPromiseData;
  if (record === undefined) throw "MODULE_PROMISE_INVARIANT";
  if (record.state === "pending") return { kind: "pending" };
  if (record.state === "fulfilled") return { kind: "fulfilled" };
  if (!record.handled) {
    realm.promiseRejectionTracker(record, "handle");
    record.handled = true;
  }
  return { kind: "rejected", error: record.result };
}
