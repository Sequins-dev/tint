import type { SourceTailCallFrame } from "./functions.ts";
import type { LoadedModuleRequest } from "../modules/records.ts";
import type { TemplateSite } from "./templates.ts";
import { enqueueFinalizationCleanupJobs } from "./finalization-registry.ts";
import type { WeakStorageService, WeakRegistryEntry } from "./weak-storage.ts";
import type { AtomicCapabilities } from "./atomics.ts";
import {
  createJobQueue,
  enqueueJob,
  drainJobs,
  type JobQueue,
} from "../jobs/index.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ObjectExecutionContext } from "./operations.ts";

/** Host identity for one successfully parsed Script, independent of compiled
 * code identity. Eval and dynamic functions inherit the active record. */
export interface ScriptRecord {
  readonly kind: "script";
  readonly realm: ErrorRealm;
  readonly hostDefined: unknown;
  readonly loadedRequests: LoadedModuleRequest[];
  /** Parsed-unit sites, independent of the effective eval/function referrer. */
  readonly templateSites: TemplateSite[];
}
export function createScriptRecord(
  realm: ErrorRealm,
  hostDefined: unknown,
): ScriptRecord {
  return {
    kind: "script",
    realm,
    hostDefined,
    loadedRequests: [],
    templateSites: [],
  };
}

export interface ScriptExecutionContext {
  readonly realm: ErrorRealm;
  /** Effective GetActiveScriptOrModule value; builtins/eval preserve the nearest
   * active identity rather than storing the specification's null context fields. */
  readonly scriptOrModule: unknown;
}
interface QueuedScriptJob {
  readonly execution: ObjectExecutionContext<unknown> | undefined;
  readonly scriptOrModule: unknown;
}
export interface ScriptAgent {
  /** Immutable host policy for this agent; other realms share the same agent. */
  readonly canSuspend: boolean;
  /** Stable target flags shared by every realm using this agent. */
  atomicsCapabilities: AtomicCapabilities | undefined;
  weakStorage: WeakStorageService | undefined;
  readonly keptAlive: unknown[];
  readonly registries: WeakRegistryEntry[];
  activeContext: ScriptExecutionContext | undefined;
  activeTailCallFrame: SourceTailCallFrame | undefined;
  /** Agent-wide order for asynchronous module dependency completion. */
  moduleAsyncEvaluationCount: number;
  readonly jobs: JobQueue<QueuedScriptJob>;
}
export function createScriptAgent(canSuspend: boolean = false): ScriptAgent {
  return {
    canSuspend,
    atomicsCapabilities: undefined,
    weakStorage: undefined,
    keptAlive: [],
    registries: [],
    activeContext: undefined,
    activeTailCallFrame: undefined,
    moduleAsyncEvaluationCount: 0,
    jobs: createJobQueue<QueuedScriptJob>(),
  };
}
export function runScriptContext<Value>(
  agent: ScriptAgent,
  context: ScriptExecutionContext,
  action: () => Value,
): Value {
  const previous = agent.activeContext;
  agent.activeContext = context;
  try {
    return action();
  } finally {
    agent.activeContext = previous;
  }
}
export function enqueueScriptJob(
  agent: ScriptAgent,
  job: () => void,
  execution: ObjectExecutionContext<unknown> | undefined,
): void {
  const active = agent.activeContext;
  enqueueJob<QueuedScriptJob>(agent.jobs, job, {
    execution,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  });
}
/** Host checkpoint only: active Script executions keep their targets alive. */
export function clearKeptObjects(agent: ScriptAgent): void {
  if (agent.activeContext === undefined) {
    agent.keptAlive.length = 0;
    enqueueFinalizationCleanupJobs(agent, enqueueScriptJob);
  }
}
export function drainScriptJobs(
  agent: ScriptAgent,
  reportError: (error: unknown) => void,
): number {
  if (agent.activeContext !== undefined || agent.jobs.draining) return 0;
  clearKeptObjects(agent);
  return drainJobs<QueuedScriptJob>(agent.jobs, (job, queued): void => {
    const invoke = (): unknown => {
      const active = agent.activeContext;
      if (active === undefined) {
        job();
        return undefined;
      }
      return runScriptContext<unknown>(
        agent,
        {
          realm: active.realm,
          scriptOrModule: queued.scriptOrModule,
        },
        (): unknown => {
          job();
          return undefined;
        },
      );
    };
    try {
      const execution = queued.execution;
      if (execution === undefined) invoke();
      else execution.run(invoke);
    } catch (error) {
      reportError(error);
    } finally {
      clearKeptObjects(agent);
    }
  });
}

/** Source functions retain their definition-time Script/module; built-ins use
 * the realm context, which preserves the caller's active Script/module. */
export function createSourceExecutionContext(
  realm: ErrorRealm,
): ObjectExecutionContext<unknown> {
  const agent = realm.agent;
  const active = agent.activeContext;
  const context: ScriptExecutionContext = {
    realm,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  };
  return {
    getRealm: (): ErrorRealm => realm,
    run: (action): unknown => runScriptContext<unknown>(agent, context, action),
  };
}

/** Realm metadata for an invocation that manages its own context boundary. */
export function createFunctionRealmContext(
  realm: ErrorRealm,
): ObjectExecutionContext<unknown> {
  return {
    getRealm: (): ErrorRealm => realm,
    run: (action): unknown => action(),
  };
}
