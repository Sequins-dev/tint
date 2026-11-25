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
  type ObjectRegisterEntry,
  type OrdinaryObject,
  type ScriptPropertyStubCache,
} from "./operations.ts";
import {
  activationArgument,
  activationArgumentCount,
  activationCallee,
  activationKind,
  activationPrevious,
  activationTop,
  youngerThanActivation,
} from "./activations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";

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
   * top of a chain of reusable frames (see SourceCallFrame). Native
   * activation records interleave with them (see activations.ts). */
  readonly executionNameBase: ExecutionNameFrame;
  executionNameTop: ExecutionNameFrame;
  executionContextDepth: number;
  activeTailCallFrame: SourceTailCallFrame | undefined;
  /** Caller-reflection frames of the active source calls, innermost at the
   * top. A visible invocation stores its callee; strict callees and
   * realm/raw-context barriers store undefined, which no caller lookup can
   * match or reveal. Legacy (sloppy ordinary) invocations also store their
   * argument list for the legacy own "arguments" accessor. Native
   * activation records interleave with them (see activations.ts). */
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
  /** The innermost native activation record when this frame was pushed. */
  nativeTop: number;
  readonly previous: SourceCallFrame | undefined;
  next: SourceCallFrame | undefined;
}
/** Reusable execution-context trace-name frame, chained like SourceCallFrame. */
export interface ExecutionNameFrame {
  name: string | undefined;
  nativeTop: number;
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
    nativeTop: 0,
    previous,
    next: undefined,
  };
}
function executionNameFrame(
  previous: ExecutionNameFrame | undefined,
): ExecutionNameFrame {
  return { name: undefined, nativeTop: 0, previous, next: undefined };
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
  const nativeTop = activationTop();
  // A hidden frame directly inside another hides nothing more.
  if (
    visibleCallee === undefined &&
    legacyArguments === undefined &&
    top.callee === undefined &&
    top.nativeTop === nativeTop
  )
    return depth;
  const reused = top.next,
    frame = reused === undefined ? sourceCallFrame(top) : reused;
  if (reused === undefined) top.next = frame;
  frame.callee = visibleCallee;
  frame.legacyArguments = legacyArguments;
  frame.nativeTop = nativeTop;
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
    }
    agent.sourceCallTop = previous;
    agent.sourceCallDepth = agent.sourceCallDepth - 1;
  }
}
/** A position in the source-call chain: heap frames and native activation
 * records of entries called with actual operands, innermost first. */
interface SourceCallCursor {
  frame: SourceCallFrame;
  record: number;
  /** The current entry: a native record, else 0 and a heap frame. */
  native: number;
  heap: SourceCallFrame | undefined;
}
function sourceCallCursor(agent: ScriptAgent): SourceCallCursor {
  return {
    frame: agent.sourceCallTop,
    record: activationTop(),
    native: 0,
    heap: undefined,
  };
}
/** Move to the next older entry; false past the outermost. */
function nextSourceCall(cursor: SourceCallCursor): boolean {
  let record = cursor.record;
  while (record !== 0 && activationKind(record) === 0)
    record = activationPrevious(record);
  const frame = cursor.frame,
    previous = frame.previous;
  if (previous === undefined && record === 0) return false;
  if (
    previous !== undefined &&
    (record === 0 || youngerThanActivation(frame.nativeTop, record))
  ) {
    cursor.native = 0;
    cursor.heap = frame;
    cursor.frame = previous;
    cursor.record = record;
  } else {
    cursor.native = record;
    cursor.heap = undefined;
    cursor.record = activationPrevious(record);
  }
  return true;
}
/** The register entry of a native record's callee (an object identity
 * witness supplies the realm-independent object view). */
function activationEntry(
  record: number,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): ObjectRegisterEntry<unknown> | undefined {
  const callee = viewObjectValue(activationCallee(record), witness);
  return callee === undefined ? undefined : callee.internalRegisterCall;
}
/** The identity the current entry exposes to caller reflection: a visible
 * callee, or undefined for strict callees and barriers. */
function visibleEntryCallee(
  cursor: SourceCallCursor,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  const heap = cursor.heap;
  if (heap !== undefined) return heap.callee;
  const record = cursor.native;
  const entry = activationEntry(record, witness);
  return entry === undefined || entry.callerPolicy === "opaque"
    ? undefined
    : activationCallee(record);
}
/** The visible source function that invoked the innermost active `callee`,
 * or undefined when it was not invoked or its caller is hidden. */
export function visibleSourceCaller(
  agent: ScriptAgent,
  callee: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  // The outermost entry has no caller.
  const cursor = sourceCallCursor(agent);
  if (!nextSourceCall(cursor)) return undefined;
  for (;;) {
    const current = visibleEntryCallee(cursor, callee);
    if (!nextSourceCall(cursor)) return undefined;
    if (current === callee) return visibleEntryCallee(cursor, callee);
  }
}
/** The argument list of the innermost active legacy invocation of `callee`,
 * or undefined when it is not executing. */
export function activeSourceArguments(
  agent: ScriptAgent,
  callee: OrdinaryObject<ScriptPropertyKey, unknown>,
): readonly unknown[] | undefined {
  const cursor = sourceCallCursor(agent);
  while (nextSourceCall(cursor)) {
    if (visibleEntryCallee(cursor, callee) !== callee) continue;
    const frame = cursor.heap;
    if (frame === undefined) {
      const record = cursor.native,
        count = activationArgumentCount(record);
      const actuals: unknown[] = [];
      for (let index = 0; index < count; index++)
        actuals.push(activationArgument(record, index));
      return actuals;
    }
    if (frame.argumentCount < 0) return frame.legacyArguments;
    if (frame.argumentCount === 0) return [];
    if (frame.argumentCount === 1) return [frame.firstArgument];
    return [frame.firstArgument, frame.secondArgument];
  }
  return undefined;
}
/** Trace names of the active source execution contexts, innermost first:
 * heap name frames merged with native records of entries called with
 * actual operands (named by their callee's register entry). */
export function activeExecutionNames(
  agent: ScriptAgent,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): string[] {
  const names: string[] = [];
  let frame = agent.executionNameTop,
    record = activationTop();
  for (;;) {
    while (record !== 0 && activationKind(record) === 0)
      record = activationPrevious(record);
    const previous = frame.previous;
    if (previous === undefined && record === 0) return names;
    if (
      previous !== undefined &&
      (record === 0 || youngerThanActivation(frame.nativeTop, record))
    ) {
      const name = frame.name;
      if (name !== undefined) names.push(name);
      frame = previous;
    } else {
      const entry = activationEntry(record, witness);
      if (entry !== undefined) names.push(entry.traceName);
      record = activationPrevious(record);
    }
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
  frame.nativeTop = activationTop();
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
/** Whether a built-in bound to `realm` runs in the active context as is. */
export function activeInRealm(agent: ScriptAgent, realm: ErrorRealm): boolean {
  const active = agent.activeContext;
  return active !== undefined && active.realm === realm;
}
/** A built-in bound to `realm` runs in the active context when that context
 * belongs to the realm. Callers without an active context enter `fallback`,
 * and callers from another realm enter the realm's own context. */
export function runRealmBoundCall(
  agent: ScriptAgent,
  realm: ErrorRealm,
  fallback: ScriptExecutionContext,
  action: () => unknown,
): unknown {
  const active = agent.activeContext ?? fallback;
  return active.realm === realm
    ? runScriptContext<unknown>(agent, active, action)
    : realm.executionContext.run(action);
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
    if (agent.keptAlive.length !== 0) agent.keptAlive.length = 0;
    if (agent.registries.length !== 0)
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
  if (agent.jobs.size === 0) return 0;
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

/** The execution context of a source function created now: the active
 * context when it belongs to `realm`, shared so that native call sites
 * compare one identity (an equal record of another identity only misses
 * that fast path), else a new record for the realm and the active Script or
 * module. */
export function functionExecutionContext(
  realm: ErrorRealm,
): ScriptExecutionContext {
  const active = realm.agent.activeContext;
  if (active !== undefined && active.realm === realm) return active;
  return {
    realm,
    scriptOrModule: active === undefined ? undefined : active.scriptOrModule,
  };
}
/** Source functions retain their definition-time Script/module; built-ins use
 * the realm context, which preserves the caller's active Script/module. */
export function createSourceExecutionContext(
  realm: ErrorRealm,
  traceName: string = "",
  callerBarrier: boolean = true,
): ObjectExecutionContext<unknown> {
  const agent = realm.agent;
  const context = functionExecutionContext(realm);
  return {
    getRealm: (): ErrorRealm => realm,
    run: (action): unknown => {
      const top = agent.executionNameTop,
        reused = top.next,
        named = reused === undefined ? executionNameFrame(top) : reused;
      if (reused === undefined) top.next = named;
      named.name = traceName;
      named.nativeTop = activationTop();
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
