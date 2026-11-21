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
import {
  createScriptPropertyStubCache,
  type ObjectExecutionContext,
  type ScriptPropertyStubCache,
} from "./operations.ts";

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
  readonly propertyStubCache: ScriptPropertyStubCache;
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
  /** Trace names of the active source execution contexts, innermost at the
   * top of a chain of reusable frames (see SourceCallFrame). */
  readonly executionNameBase: ExecutionNameFrame;
  executionNameTop: ExecutionNameFrame;
  executionContextDepth: number;
  activeTailCallFrame: SourceTailCallFrame | undefined;
  /** Caller-reflection frames of the active source calls, innermost at the
   * top. A visible invocation stores its callee; strict callees and
   * realm/raw-context barriers store undefined, which no caller lookup can
   * match or reveal. Legacy (sloppy ordinary) invocations also store their
   * argument list for the legacy own "arguments" accessor. */
  readonly sourceCallBase: SourceCallFrame;
  sourceCallTop: SourceCallFrame;
  sourceCallDepth: number;
  /** Agent-wide order for asynchronous module dependency completion. */
  moduleAsyncEvaluationCount: number;
  /** Next agent-unique object identity; identities are assigned on demand. */
  nextObjectIdentity: number;
  readonly jobs: JobQueue<QueuedScriptJob>;
}
/** Reusable caller-reflection frame. Frames form a chain from the agent's
 * base frame that grows on demand and is cleared on every exit, so entering
 * and leaving a call writes record fields instead of list slots, and
 * returned callees and argument lists stay collectable. */
export interface SourceCallFrame {
  callee: unknown;
  legacyArguments: readonly unknown[] | undefined;
  argumentCount: number;
  firstArgument: unknown;
  secondArgument: unknown;
  argumentRegisters: number;
  argumentStack: number;
  argumentReader: SourceArgumentReader | undefined;
  readonly previous: SourceCallFrame | undefined;
  next: SourceCallFrame | undefined;
}
export type SourceArgumentReader = (
  index: number,
  count: number,
  registers: number,
  stack: number,
) => unknown;
/** Reusable execution-context trace-name frame, chained like SourceCallFrame. */
export interface ExecutionNameFrame {
  name: string | undefined;
  readonly previous: ExecutionNameFrame | undefined;
  next: ExecutionNameFrame | undefined;
}
function sourceCallFrame(
  previous: SourceCallFrame | undefined,
): SourceCallFrame {
  return {
    callee: undefined,
    legacyArguments: undefined,
    argumentCount: -1,
    firstArgument: undefined,
    secondArgument: undefined,
    argumentRegisters: 0,
    argumentStack: 0,
    argumentReader: undefined,
    previous,
    next: undefined,
  };
}
function executionNameFrame(
  previous: ExecutionNameFrame | undefined,
): ExecutionNameFrame {
  return { name: undefined, previous, next: undefined };
}
export function createScriptAgent(canSuspend: boolean = false): ScriptAgent {
  const sourceCallBase = sourceCallFrame(undefined),
    executionNameBase = executionNameFrame(undefined);
  return {
    pendingAtomicWaits: [],
    canSuspend,
    propertyStubCache: createScriptPropertyStubCache(),
    atomicsCapabilities: undefined,
    weakStorage: undefined,
    stackGuard: undefined,
    keptAlive: [],
    registries: [],
    activeContext: undefined,
    executionNameBase,
    executionNameTop: executionNameBase,
    executionContextDepth: 0,
    activeTailCallFrame: undefined,
    sourceCallBase,
    sourceCallTop: sourceCallBase,
    sourceCallDepth: 0,
    moduleAsyncEvaluationCount: 0,
    nextObjectIdentity: 1,
    jobs: createJobQueue<QueuedScriptJob>(),
  };
}
/** Track the visible caller. Hidden frames can share the nearest barrier.
 * Pair every entry with `exitSourceCall` in a finally block. */
export function enterSourceCall(
  agent: ScriptAgent,
  visibleCallee: unknown,
  legacyArguments: readonly unknown[] | undefined = undefined,
): number {
  const top = agent.sourceCallTop;
  const depth = agent.sourceCallDepth;
  if (
    visibleCallee === undefined &&
    legacyArguments === undefined &&
    top.callee === undefined
  )
    return depth;
  const reused = top.next,
    frame = reused === undefined ? sourceCallFrame(top) : reused;
  if (reused === undefined) top.next = frame;
  frame.callee = visibleCallee;
  frame.legacyArguments = legacyArguments;
  agent.sourceCallTop = frame;
  agent.sourceCallDepth = depth + 1;
  return depth;
}
export function enterRegisterSourceCall(
  agent: ScriptAgent,
  visibleCallee: unknown,
  argumentCount: number,
  firstArgument: unknown,
  secondArgument: unknown,
): number {
  const depth = enterSourceCall(agent, visibleCallee);
  if (argumentCount >= 0) {
    const frame = agent.sourceCallTop;
    frame.argumentCount = argumentCount;
    frame.firstArgument = firstArgument;
    frame.secondArgument = secondArgument;
  }
  return depth;
}
/** The addresses are valid only while this compiled source frame is active.
 * Its maps keep the values at both addresses current across collections. */
export function enterNativeSourceCall(
  agent: ScriptAgent,
  callee: unknown,
  count: number,
  registers: number,
  stack: number,
  reader: SourceArgumentReader,
): number {
  const depth = enterSourceCall(agent, callee);
  const frame = agent.sourceCallTop;
  frame.argumentCount = count;
  frame.argumentRegisters = registers;
  frame.argumentStack = stack;
  frame.argumentReader = reader;
  return depth;
}
export function exitSourceCall(agent: ScriptAgent, depth: number): void {
  // Clearing keeps returned callees collectable once their invocation ends.
  while (agent.sourceCallDepth > depth) {
    const frame = agent.sourceCallTop,
      previous = frame.previous;
    if (previous === undefined) throw "SOURCE_CALL_FRAME_INVARIANT";
    frame.callee = undefined;
    frame.legacyArguments = undefined;
    if (frame.argumentCount >= 0) {
      frame.argumentCount = -1;
      frame.firstArgument = undefined;
      frame.secondArgument = undefined;
      frame.argumentRegisters = 0;
      frame.argumentStack = 0;
      frame.argumentReader = undefined;
    }
    agent.sourceCallTop = previous;
    agent.sourceCallDepth = agent.sourceCallDepth - 1;
  }
}
/** The visible source function that invoked the innermost active `callee`,
 * or undefined when it was not invoked or its caller is hidden. */
export function visibleSourceCaller(
  agent: ScriptAgent,
  callee: unknown,
): unknown {
  // The outermost frame has no caller; the base frame is not a call.
  let frame = agent.sourceCallTop;
  for (;;) {
    const previous = frame.previous;
    if (previous === undefined || previous.previous === undefined)
      return undefined;
    if (frame.callee === callee) return previous.callee;
    frame = previous;
  }
}
/** The argument list of the innermost active legacy invocation of `callee`,
 * or undefined when it is not executing. */
export function activeSourceArguments(
  agent: ScriptAgent,
  callee: unknown,
): readonly unknown[] | undefined {
  let frame = agent.sourceCallTop;
  for (;;) {
    const previous = frame.previous;
    if (previous === undefined) return undefined;
    if (frame.callee === callee) {
      if (frame.argumentCount < 0) return frame.legacyArguments;
      const reader = frame.argumentReader;
      if (reader !== undefined) {
        const actuals: unknown[] = [];
        const count = frame.argumentCount;
        for (let index = 0; index < count; index++)
          actuals.push(
            reader(index, count, frame.argumentRegisters, frame.argumentStack),
          );
        return actuals;
      }
      if (frame.argumentCount === 0) return [];
      if (frame.argumentCount === 1) return [frame.firstArgument];
      return [frame.firstArgument, frame.secondArgument];
    }
    frame = previous;
  }
}

/** Reuse the named frame while a same-Script register entry executes inline. */
export function enterExecutionName(
  agent: ScriptAgent,
  name: string,
): ExecutionNameFrame {
  const top = agent.executionNameTop;
  const reused = top.next;
  const frame = reused === undefined ? executionNameFrame(top) : reused;
  if (reused === undefined) top.next = frame;
  frame.name = name;
  agent.executionNameTop = frame;
  return top;
}
export function leaveExecutionName(
  agent: ScriptAgent,
  previous: ExecutionNameFrame,
): void {
  agent.executionNameTop.name = undefined;
  agent.executionNameTop = previous;
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
      const top = agent.executionNameTop,
        reused = top.next,
        named = reused === undefined ? executionNameFrame(top) : reused;
      if (reused === undefined) top.next = named;
      named.name = traceName;
      agent.executionNameTop = named;
      // Raw class and suspended-body drivers form a caller privacy barrier.
      const barrier = callerBarrier ? enterSourceCall(agent, undefined) : -1;
      try {
        return runScriptContext<unknown>(agent, context, action);
      } finally {
        named.name = undefined;
        agent.executionNameTop = top;
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
