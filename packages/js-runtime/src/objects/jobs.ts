import type { SourceTailCallFrame } from "./functions.ts";
import type { LoadedModuleRequest } from "../modules/records.ts";
import type { TemplateSite } from "./templates.ts";
import { enqueueFinalizationCleanupJobs } from "./finalization-registry.ts";
import type { WeakStorageService, WeakRegistryEntry } from "./weak-storage.ts";
import type { AtomicCapabilities } from "./atomics.ts";
import type { PendingAtomicWait } from "./atomics-wait.ts";
import {
  createJobQueue,
  enqueueJob,
  drainJobs,
  type JobQueue,
} from "../jobs/index.ts";
import { rejectEngineAbort, type ErrorRealm } from "./errors.ts";
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
  /** String-literal values of this parse when its compiled entry is shared by
   * other parses that differ only in those values (see getScriptLiteral). */
  readonly literals: readonly string[];
}
export function createScriptRecord(
  realm: ErrorRealm,
  hostDefined: unknown,
  literals: readonly string[] = [],
): ScriptRecord {
  return {
    kind: "script",
    realm,
    hostDefined,
    loadedRequests: [],
    templateSites: [],
    literals,
  };
}
/** A shared compiled entry reads this parse's string-literal values by
 * ordinal. The compiler issues ordinals and values together, so a missing
 * value is an engine invariant violation, never JavaScript-visible. */
export function getScriptLiteral(owner: ScriptRecord, index: number): string {
  const value = owner.literals[index];
  if (value === undefined || index !== Math.trunc(index))
    throw "SCRIPT_LITERAL_INVARIANT";
  return value;
}

export interface ScriptExecutionContext {
  readonly realm: ErrorRealm;
  /** Effective GetActiveScriptOrModule value; builtins/eval preserve the nearest
   * active identity rather than storing the specification's null context fields. */
  readonly scriptOrModule: unknown;
}
export interface StackGuard {
  /** Whether a thrown value is the one the native stack guard throws for a
   * stack overflow. It depends only on the value, never on earlier events. */
  readonly isOverflow: (value: unknown) => boolean;
}
interface QueuedScriptJob {
  readonly execution: ObjectExecutionContext<unknown> | undefined;
  readonly scriptOrModule: unknown;
}
export interface ScriptAgent {
  readonly pendingAtomicWaits: PendingAtomicWait[];
  /** Immutable host policy for this agent; other realms share the same agent. */
  readonly canSuspend: boolean;
  /** Stable target flags shared by every realm using this agent. */
  atomicsCapabilities: AtomicCapabilities | undefined;
  weakStorage: WeakStorageService | undefined;
  /** Native host stack guard: a prologue that would cross the stack limit
   * throws a value that identifies itself as an overflow; JavaScript catch
   * boundaries convert it into a RangeError. Absent on hosts without one. */
  stackGuard: StackGuard | undefined;
  readonly keptAlive: unknown[];
  readonly registries: WeakRegistryEntry[];
  activeContext: ScriptExecutionContext | undefined;
  /** Reused slots avoid allocating a linked frame on every function call. */
  readonly executionContextNames: (string | undefined)[];
  executionContextDepth: number;
  activeTailCallFrame: SourceTailCallFrame | undefined;
  /** Caller-reflection slots indexed by source-call depth, reused like the
   * execution-context names. A visible invocation stores its callee; strict
   * callees and realm/raw-context barriers store undefined, which no caller
   * lookup can match or reveal. Slots at and above the depth are cleared. */
  readonly sourceCallers: unknown[];
  /** Argument lists of legacy (sloppy ordinary) invocations at the same
   * depths, for the legacy own "arguments" accessor; undefined elsewhere. */
  readonly sourceArguments: (readonly unknown[] | undefined)[];
  sourceCallDepth: number;
  /** Agent-wide order for asynchronous module dependency completion. */
  moduleAsyncEvaluationCount: number;
  /** Next agent-unique object identity; identities are assigned on demand. */
  nextObjectIdentity: number;
  readonly jobs: JobQueue<QueuedScriptJob>;
}
export function createScriptAgent(canSuspend: boolean = false): ScriptAgent {
  return {
    pendingAtomicWaits: [],
    canSuspend,
    atomicsCapabilities: undefined,
    weakStorage: undefined,
    stackGuard: undefined,
    keptAlive: [],
    registries: [],
    activeContext: undefined,
    executionContextNames: [],
    executionContextDepth: 0,
    activeTailCallFrame: undefined,
    sourceCallers: [],
    sourceArguments: [],
    sourceCallDepth: 0,
    moduleAsyncEvaluationCount: 0,
    nextObjectIdentity: 1,
    jobs: createJobQueue<QueuedScriptJob>(),
  };
}
/** Push a caller-reflection slot; `visibleCallee` is undefined for hidden
 * frames. Pair every entry with `exitSourceCall` in a finally block. */
export function enterSourceCall(
  agent: ScriptAgent,
  visibleCallee: unknown,
  legacyArguments: readonly unknown[] | undefined = undefined,
): number {
  const depth = agent.sourceCallDepth;
  agent.sourceCallers[depth] = visibleCallee;
  agent.sourceArguments[depth] = legacyArguments;
  agent.sourceCallDepth = depth + 1;
  return depth;
}
export function exitSourceCall(agent: ScriptAgent, depth: number): void {
  // Clearing keeps returned callees collectable once their invocation ends.
  agent.sourceCallers[depth] = undefined;
  agent.sourceArguments[depth] = undefined;
  agent.sourceCallDepth = depth;
}
/** The visible source function that invoked the innermost active `callee`,
 * or undefined when it was not invoked or its caller is hidden. */
export function visibleSourceCaller(
  agent: ScriptAgent,
  callee: unknown,
): unknown {
  const callers = agent.sourceCallers;
  for (let index = agent.sourceCallDepth - 1; index > 0; index--)
    if (callers[index] === callee) return callers[index - 1];
  return undefined;
}
/** The argument list of the innermost active legacy invocation of `callee`,
 * or undefined when it is not executing. */
export function activeSourceArguments(
  agent: ScriptAgent,
  callee: unknown,
): readonly unknown[] | undefined {
  const callers = agent.sourceCallers;
  for (let index = agent.sourceCallDepth - 1; index >= 0; index--)
    if (callers[index] === callee) return agent.sourceArguments[index];
  return undefined;
}
/** The agent state `enterScriptContext` replaced, for `leaveScriptContext`. */
export interface ScriptContextFrame {
  readonly previous: ScriptExecutionContext | undefined;
  readonly depth: number;
}
/** runScriptContext's entry half, for runtime-compiled entries that run their
 * body inline: `const frame = enterScriptContext(agent, context); try { body }
 * finally { leaveScriptContext(agent, frame); }` is runScriptContext exactly.
 * Inline bodies call runtime helpers directly instead of through captures. */
export function enterScriptContext(
  agent: ScriptAgent,
  context: ScriptExecutionContext,
): ScriptContextFrame {
  const frame: ScriptContextFrame = {
    previous: agent.activeContext,
    depth: agent.executionContextDepth,
  };
  agent.executionContextDepth = frame.depth + 1;
  agent.activeContext = context;
  return frame;
}
export function leaveScriptContext(
  agent: ScriptAgent,
  frame: ScriptContextFrame,
): void {
  agent.executionContextDepth = frame.depth;
  agent.activeContext = frame.previous;
}
export function runScriptContext<Value>(
  agent: ScriptAgent,
  context: ScriptExecutionContext,
  action: () => Value,
): Value {
  const previous = agent.activeContext;
  const depth = agent.executionContextDepth;
  agent.executionContextDepth = depth + 1;
  agent.activeContext = context;
  try {
    return action();
  } finally {
    agent.executionContextDepth = depth;
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
  checkpoint?: () => void,
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
      // An engine abort ends the job's realm as unsupported, like other engine
      // limits, and is not a JavaScript job error; a stack overflow is
      // reported as its RangeError. Without a realm, hosts receive the value.
      const execution = queued.execution,
        getRealm = execution === undefined ? undefined : execution.getRealm;
      const jobRealm = getRealm === undefined ? undefined : getRealm();
      let reported: unknown = error,
        aborted = false;
      if (jobRealm !== undefined)
        try {
          reported = rejectEngineAbort(jobRealm, error);
        } catch {
          aborted = true;
        }
      if (!aborted) reportError(reported);
    } finally {
      clearKeptObjects(agent);
      // Hosts may publish owner-local event completions between jobs, even
      // when a running job keeps the FIFO queue nonempty. Never inside Script.
      if (checkpoint !== undefined) checkpoint();
    }
  });
}

/** Source functions retain their definition-time Script/module; built-ins use
 * the realm context, which preserves the caller's active Script/module. */
export function createSourceExecutionContext(
  realm: ErrorRealm,
  traceName: string = "",
  callerBarrier: boolean = true,
): ObjectExecutionContext<unknown> {
  const agent = realm.agent;
  const active = agent.activeContext;
  const context: ScriptExecutionContext = {
    realm,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  };
  return {
    getRealm: (): ErrorRealm => realm,
    run: (action): unknown => {
      const depth = agent.executionContextDepth;
      agent.executionContextNames[depth] = traceName;
      // Raw class and suspended-body drivers form a caller privacy barrier.
      const barrier = callerBarrier ? enterSourceCall(agent, undefined) : -1;
      try {
        return runScriptContext<unknown>(agent, context, action);
      } finally {
        agent.executionContextNames[depth] = undefined;
        if (barrier >= 0) exitSourceCall(agent, barrier);
      }
    },
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
