// The plugin boundary of the DevTools bridge. The core maps CDP onto DAP
// in language-neutral terms (scripts from line tables, breakpoints, frames,
// scopes, variables, process output, CPU samples); a plugin adds what a
// runtime knows:
//
// - value formatting: DAP variables (with the runtime's LLDB formatters)
//   as JavaScript-like RemoteObjects;
// - frame presentation: display names of (inlined) frames;
// - extra CDP domains or methods (HeapProfiler for Tint);
// - direct fast paths for bulk memory (an LLDB script reading memory
//   in-process, or a core file) through `command`, since DAP readMemory is
//   too slow for GB-scale heaps.
//
// Phase 2 hooks (not implemented yet): `evaluate` would evaluate an
// expression on a paused call frame (for Tint: by calling the embedded
// compiler in the process at a safepoint); `consoleBreakpoints` would name
// functions whose breakpoints yield structured console.* messages; and
// `asyncStackBreakpoints` would name promise-job enqueue/run functions for
// opt-in async stack traces. See docs/native-devtools.md.
import type { DebugBackend } from "./backend.ts";

export interface RemoteObject {
  readonly type:
    | "object"
    | "function"
    | "undefined"
    | "string"
    | "number"
    | "boolean"
    | "symbol"
    | "bigint";
  readonly subtype?: string;
  readonly className?: string;
  readonly value?: unknown;
  readonly unserializableValue?: string;
  readonly description?: string;
  readonly objectId?: string;
}
export interface DapVariable {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly variablesReference: number;
  readonly namedVariables?: number;
  readonly indexedVariables?: number;
  readonly evaluateName?: string;
  readonly memoryReference?: string;
}
export interface DapStackFrame {
  readonly id: number;
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly source?: {
    readonly name?: string;
    readonly path?: string;
    readonly sourceReference?: number;
    readonly presentationHint?: string;
  };
  readonly instructionPointerReference?: string;
  readonly presentationHint?: string;
}
export interface DapStoppedEvent {
  readonly reason: string;
  readonly description?: string;
  readonly threadId?: number;
  readonly hitBreakpointIds?: number[];
  readonly text?: string;
}

export type TargetState = "starting" | "running" | "paused" | "exited";

/** A stop the bridge did not ask for interrupted an internal operation
 * (for example a user breakpoint before the safepoint was reached). */
export class UserStopError extends Error {
  readonly stopped: DapStoppedEvent;
  constructor(stopped: DapStoppedEvent) {
    super(
      "stopped by " +
        (stopped.description ?? stopped.reason) +
        " before the operation completed",
    );
    this.stopped = stopped;
  }
}

/** Controls the process while the frontend sees no pause: stops are
 * delivered to the operation instead of becoming Debugger.paused. */
export interface InternalOperation {
  command(text: string, timeoutMs?: number): Promise<string>;
  /** Replaces the bridge's function breakpoints; returns their DAP ids. */
  setFunctionBreakpoints(names: readonly string[]): Promise<number[]>;
  /** Continues until the process stops at one of `breakpointIds`; a stop
   * elsewhere throws UserStopError; the timeout pauses and throws. */
  continueToBreakpoint(
    breakpointIds: readonly number[],
    timeoutMs: number,
  ): Promise<DapStoppedEvent>;
  readonly threadId: number;
}

export interface BridgeContext {
  readonly backend: DebugBackend;
  readonly program: string | undefined;
  /** A scratch directory for dumps and profiles (removed at exit). */
  readonly workDirectory: string;
  pid(): number | undefined;
  state(): TargetState;
  /** Resolves once a launched program has started running its own code:
   * its entry point has run, so dyld startup (during which the debugger
   * holds the process at internal stops) is over. Immediate for attached
   * processes and backends that cannot tell. */
  programEntered(timeoutMs: number): Promise<void>;
  /** A native debugger command (rejects when the backend has none). */
  command(text: string, timeoutMs?: number): Promise<string>;
  /** Runs `body` with the process stopped; afterwards the process resumes,
   * or (if the frontend had it paused) is presented paused again. */
  internal<T>(body: (operation: InternalOperation) => Promise<T>): Promise<T>;
  /** Sends a CDP event; resolves when the socket can take more. */
  emit(method: string, params: object): Promise<void>;
  /** The Debugger script id of a source file (as DWARF spells it). */
  scriptIdOf(file: string): string | undefined;
  /** The script url of a source file (as DWARF spells it). */
  urlOf(file: string): string;
  /** A frame's display name after every plugin's frameName. */
  frameName(name: string): string;
  /** Function breakpoints a plugin keeps across operations (replacing the
   * owner's previous set); returns their DAP ids. */
  setPersistentFunctionBreakpoints(
    owner: string,
    names: readonly string[],
  ): Promise<number[]>;
  /** Called for each stop before it is presented (or interrupts an
   * operation); returning true continues the process instead, as for a
   * sampling breakpoint. `resume` is false when the bridge keeps the
   * process stopped anyway (it was pausing). */
  addStopHandler(
    handler: (stopped: DapStoppedEvent, resume: boolean) => Promise<boolean>,
  ): void;
  log(text: string): void;
}

export type MethodHandler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface BridgePlugin {
  readonly name: string;
  /** Debugger commands run when the adapter starts (e.g. loading the
   * runtime's LLDB formatters). */
  initCommands?(): string[];
  /** The display name of a frame (DAP frame name). */
  frameName?(name: string): string;
  /** Hides a leading frame (runtime internals the bridge stopped in, such
   * as an allocation hook) so the pause shows the program's frame. */
  hideFrame?(name: string): boolean;
  /** A RemoteObject for a variable; undefined: use the generic mapping;
   * null: hide the variable. `objectId` expands its DAP children. */
  formatVariable?(
    variable: DapVariable,
    objectId: string | undefined,
  ): RemoteObject | null | undefined;
  /** The property name of a variable (e.g. `[0]` -> `0`). */
  propertyName?(variable: DapVariable): string | undefined;
  /** Extra CDP methods by full name; they override the core's. */
  methods?(): Record<string, MethodHandler>;
  attach?(context: BridgeContext): void;
  /** Called once the process is gone. */
  dispose?(): Promise<void> | void;
}
