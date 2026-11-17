// The CDP <-> DAP core: one debuggee (launched or attached through a DAP
// adapter) presented to a Chrome DevTools frontend as a Node-like target.
//
//   Debugger  scripts from the debug info's line tables (scriptParsed,
//             getScriptSource), breakpoints by url/urlRegex/location,
//             pause/resume/step, paused with call frames (inlined frames
//             separate) and scope chains
//   Runtime   getProperties from DAP variables, process lifecycle,
//             evaluateOnCallFrame for plain variable paths (no code runs)
//   Console   the launched process's output, one message per line
//
// Plugins add value formatting, frame names and domains (plugin.ts). Every
// method the bridge does not implement answers with a CDP error.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DebugBackend, LaunchRequest } from "./backend.ts";
import type { DapEvent } from "./dap-client.ts";
import {
  UserStopError,
  type BridgeContext,
  type BridgePlugin,
  type DapStackFrame,
  type DapStoppedEvent,
  type DapVariable,
  type InternalOperation,
  type MethodHandler,
  type RemoteObject,
  type TargetState,
} from "./plugin.ts";
import { genericRemoteObject, propertyNameOf } from "./values.ts";

export class CdpError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
class StopTimeout extends Error {
  constructor(what: string, timeoutMs: number) {
    super("no " + what + " stop within " + String(timeoutMs) + " ms");
  }
}

export const methodNotFound = (method: string): CdpError =>
  new CdpError(-32601, "'" + method + "' wasn't found");
export const notSupported = (what: string): CdpError =>
  new CdpError(-32000, what + " is not supported by the native bridge");

/** The frontend connection: sends one CDP message. */
export interface Frontend {
  send(message: object): Promise<void>;
}

export interface BridgeOptions {
  readonly backend: DebugBackend;
  readonly launch?: LaunchRequest | undefined;
  readonly attachPid?: number | undefined;
  /** Delay the process start until Runtime.runIfWaitingForDebugger. */
  readonly wait?: boolean | undefined;
  /** Directories that relative debug-info paths resolve against. */
  readonly sourceRoots?: readonly string[] | undefined;
  /** Debug-info path -> file on disk (e.g. a hosted fixture's `fixture`). */
  readonly sourceMap?: ReadonlyMap<string, string> | undefined;
  readonly plugins?: readonly BridgePlugin[] | undefined;
  readonly log?: ((text: string) => void) | undefined;
}

interface Script {
  readonly id: string;
  readonly url: string;
  /** The path as the debug info (and the adapter) spells it. */
  readonly dapPath: string | undefined;
  readonly diskPath: string | undefined;
  readonly sourceReference: number | undefined;
  source: string | undefined;
  announced: boolean;
}

interface Breakpoint {
  readonly id: string;
  readonly url: string | undefined;
  readonly urlRegex: RegExp | undefined;
  readonly line: number;
  readonly column: number | undefined;
  readonly condition: string | undefined;
  /** Resolved locations by DAP path. */
  readonly locations: Map<
    string,
    { line: number; column: number; verified: boolean }
  >;
}

interface PauseState {
  readonly epoch: number;
  readonly threadId: number;
  readonly stopped: DapStoppedEvent;
  readonly callFrames: object[];
  readonly frameIds: Map<string, number>;
}

interface ConsoleEntry {
  readonly type: string;
  readonly text: string;
  readonly timestamp: number;
}

const contextId = 1;
const maxFrames = 64;

export class Bridge implements BridgeContext {
  readonly backend: DebugBackend;
  readonly program: string | undefined;
  readonly workDirectory: string;
  readonly targetId: string;
  private readonly options: BridgeOptions;
  private readonly plugins: readonly BridgePlugin[];
  private readonly handlers = new Map<string, MethodHandler>();
  private frontend: Frontend | undefined;
  private targetState: TargetState = "starting";
  private processId: number | undefined;
  private exitCode: number | undefined;
  private configurationDone: (() => Promise<void>) | undefined;
  /** A launched process's entry point is watched (see `programEntered`);
   * once it has run, the watch is over. */
  private entryWatched = false;
  private readonly scripts = new Map<string, Script>();
  private readonly scriptsByDapPath = new Map<string, Script>();
  private readonly scriptsByUrl = new Map<string, Script>();
  private readonly scriptsByReference = new Map<number, Script>();
  private nextScriptId = 1;
  private readonly breakpoints = new Map<string, Breakpoint>();
  private nextBreakpointId = 1;
  private readonly dapBreakpoints = new Map<
    number,
    { breakpoint: string; path: string }
  >();
  private readonly syncedPaths = new Set<string>();
  private breakpointsActive = true;
  private functionBreakpointNames: readonly string[] = [];
  private readonly persistentFunctions = new Map<string, readonly string[]>();
  private readonly stopHandlers: ((
    stopped: DapStoppedEvent,
    resume: boolean,
  ) => Promise<boolean>)[] = [];
  private pause: PauseState | undefined;
  private epoch = 0;
  private debuggerEnabled = false;
  private runtimeEnabled = false;
  private readonly consoleHistory: ConsoleEntry[] = [];
  private readonly lineBuffers = new Map<string, string>();
  private lastThreadId: number | undefined;
  private readonly pendingStops: DapStoppedEvent[] = [];
  private internalDepth = 0;
  private readonly internalWaiters: ((
    event: DapStoppedEvent | "exited",
  ) => void)[] = [];
  private exclusiveTail: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(options: BridgeOptions) {
    this.options = options;
    this.backend = options.backend;
    this.program = options.launch?.program;
    this.plugins = options.plugins ?? [];
    this.workDirectory = mkdtempSync(join(tmpdir(), "tint-devtools-"));
    this.targetId = crypto.randomUUID();
    this.registerCoreMethods();
    for (const plugin of this.plugins) {
      for (const [name, handler] of Object.entries(plugin.methods?.() ?? {}))
        this.handlers.set(name, handler);
      plugin.attach?.(this);
    }
    this.backend.dap.on("event", (event: DapEvent) => this.onDapEvent(event));
    this.ready = this.start();
  }

  // ---------------------------------------------------------------------
  // BridgeContext

  pid(): number | undefined {
    return this.processId;
  }
  state(): TargetState {
    return this.targetState;
  }
  log(text: string): void {
    this.options.log?.(text);
  }
  async programEntered(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs,
      entered = this.backend.entered?.bind(this.backend);
    while (this.entryWatched && entered !== undefined) {
      if (this.targetState === "exited")
        throw new CdpError(-32000, "the process exited");
      if (this.targetState !== "starting" && (await entered())) {
        this.entryWatched = false;
        return;
      }
      if (Date.now() > deadline)
        throw new CdpError(
          -32000,
          "the program did not reach its entry point within " +
            String(timeoutMs / 1000) +
            " s",
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async command(text: string, timeoutMs?: number): Promise<string> {
    const run = this.backend.command;
    if (run === undefined)
      throw new CdpError(
        -32000,
        "the " + this.backend.name + " backend has no native commands",
      );
    return run(text, timeoutMs);
  }
  async emit(method: string, params: object): Promise<void> {
    if (this.frontend !== undefined)
      await this.frontend.send({ method, params });
  }
  scriptIdOf(file: string): string | undefined {
    return (this.scriptsByDapPath.get(file) ?? this.scriptsByUrl.get(file))?.id;
  }
  urlOf(file: string): string {
    return this.scriptsByDapPath.get(file)?.url ?? this.scriptUrl(file);
  }

  // ---------------------------------------------------------------------
  // Startup

  private async start(): Promise<void> {
    const dap = this.backend.dap;
    await dap.request("initialize", {
      clientID: "tint-devtools",
      clientName: "Tint DevTools bridge",
      adapterID: this.backend.name,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
      supportsVariablePaging: false,
      supportsMemoryReferences: true,
      supportsRunInTerminalRequest: false,
    });
    const initCommands = this.plugins.flatMap(
      (plugin) => plugin.initCommands?.() ?? [],
    );
    const initialized = dap.waitFor("initialized", 120000);
    let started: Promise<unknown>;
    if (this.options.attachPid !== undefined) {
      this.processId = this.options.attachPid;
      started = dap.request(
        "attach",
        this.backend.attachArguments(this.options.attachPid, initCommands),
      );
    } else if (this.options.launch !== undefined) {
      started = dap.request(
        "launch",
        this.backend.launchArguments(this.options.launch, initCommands),
      );
    } else throw Error("launch or attachPid is required");
    // Breakpoints and sources need only the target; the process starts at
    // configurationDone, which --wait defers to runIfWaitingForDebugger.
    started.catch(() => {});
    await initialized;
    await this.loadScripts();
    if (
      this.options.launch !== undefined &&
      this.backend.watchEntry !== undefined
    )
      this.entryWatched = await this.backend
        .watchEntry()
        .catch((error: unknown) => {
          this.log("cannot watch the entry point: " + String(error));
          return false;
        });
    const done = async (): Promise<void> => {
      this.configurationDone = undefined;
      this.targetState = "running";
      await dap.request("configurationDone");
      await started;
    };
    if (this.options.wait === true) this.configurationDone = done;
    else await done();
  }

  private async loadScripts(): Promise<void> {
    const sources = await this.backend.sources?.().catch((error: unknown) => {
      this.log("cannot list sources: " + String(error));
      return [];
    });
    for (const path of sources ?? []) this.scriptForPath(path);
  }

  /** The file on disk for a debug-info path, if any. */
  private resolveDisk(path: string): string | undefined {
    const mapped = this.options.sourceMap?.get(path);
    if (mapped !== undefined) return mapped;
    if (isAbsolute(path)) return existsSync(path) ? path : undefined;
    const roots = [
      ...(this.options.sourceRoots ?? []),
      process.cwd(),
      ...(this.program === undefined ? [] : [resolve(this.program, "..")]),
    ];
    for (const root of roots) {
      const candidate = resolve(root, path);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  private scriptUrl(path: string): string {
    const disk = this.resolveDisk(path);
    return disk === undefined ? path : pathToFileURL(disk).href;
  }

  private scriptForPath(path: string): Script {
    const known = this.scriptsByDapPath.get(path);
    if (known !== undefined) return known;
    const disk = this.resolveDisk(path);
    const script: Script = {
      id: String(this.nextScriptId++),
      url: disk === undefined ? path : pathToFileURL(disk).href,
      dapPath: path,
      diskPath: disk,
      sourceReference: undefined,
      source: undefined,
      announced: false,
    };
    this.addScript(script);
    return script;
  }

  private scriptForReference(reference: number, name: string): Script {
    const known = this.scriptsByReference.get(reference);
    if (known !== undefined) return known;
    const script: Script = {
      id: String(this.nextScriptId++),
      url: "native-disassembly:///" + encodeURIComponent(name),
      dapPath: undefined,
      diskPath: undefined,
      sourceReference: reference,
      source: undefined,
      announced: false,
    };
    this.scriptsByReference.set(reference, script);
    this.addScript(script);
    return script;
  }

  private addScript(script: Script): void {
    this.scripts.set(script.id, script);
    if (script.dapPath !== undefined)
      this.scriptsByDapPath.set(script.dapPath, script);
    if (!this.scriptsByUrl.has(script.url))
      this.scriptsByUrl.set(script.url, script);
    if (this.debuggerEnabled) void this.announce(script);
  }

  private async announce(script: Script): Promise<void> {
    script.announced = true;
    let endLine = 0;
    if (script.diskPath !== undefined) {
      try {
        script.source ??= readFileSync(script.diskPath, "utf8");
      } catch {
        script.source = undefined;
      }
    }
    if (script.source !== undefined) endLine = script.source.split("\n").length;
    await this.emit("Debugger.scriptParsed", {
      scriptId: script.id,
      url: script.url,
      startLine: 0,
      startColumn: 0,
      endLine,
      endColumn: 0,
      executionContextId: contextId,
      hash: "",
      isLiveEdit: false,
      sourceMapURL: "",
      hasSourceURL: false,
      isModule: false,
      length: script.source?.length ?? 0,
      scriptLanguage: "JavaScript",
      embedderName: script.url,
    });
  }

  // ---------------------------------------------------------------------
  // Frontend connection

  /** Attaches a frontend; replays the target's state as it enables
   * domains. Returns a detach function. */
  connect(frontend: Frontend): () => void {
    this.frontend = frontend;
    this.debuggerEnabled = false;
    this.runtimeEnabled = false;
    for (const script of this.scripts.values()) script.announced = false;
    return () => {
      if (this.frontend === frontend) {
        this.frontend = undefined;
        this.debuggerEnabled = false;
        this.runtimeEnabled = false;
      }
    };
  }

  /** Dispatches one CDP message from the frontend and sends the reply. */
  async dispatch(message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  }): Promise<void> {
    const id = message.id,
      method = message.method ?? "";
    let reply: object;
    try {
      await this.ready;
      const handler = this.handlers.get(method);
      if (handler === undefined) throw methodNotFound(method);
      const result = (await handler(message.params ?? {})) ?? {};
      reply = { id, result };
    } catch (error) {
      const code = error instanceof CdpError ? error.code : -32000;
      const text = error instanceof Error ? error.message : String(error);
      reply = { id, error: { code, message: text } };
    }
    if (message.sessionId !== undefined)
      reply = { ...reply, sessionId: message.sessionId };
    await this.frontend?.send(reply);
  }

  /** The implemented methods, for /json/protocol. */
  methods(): string[] {
    return [...this.handlers.keys()].sort();
  }

  // ---------------------------------------------------------------------
  // DAP events

  private onDapEvent(event: DapEvent): void {
    const body = (event.body ?? {}) as Record<string, unknown>;
    switch (event.event) {
      case "process":
        if (typeof body.systemProcessId === "number")
          this.processId = body.systemProcessId;
        break;
      case "thread":
        if (body.reason === "started" && typeof body.threadId === "number")
          this.lastThreadId ??= body.threadId;
        break;
      case "stopped":
        if (typeof body.threadId === "number")
          this.lastThreadId = body.threadId;
        this.onStopped(body as unknown as DapStoppedEvent);
        break;
      case "continued":
        if (this.internalDepth === 0 && this.targetState === "paused")
          this.onResumed();
        break;
      case "exited":
        this.exitCode =
          typeof body.exitCode === "number" ? body.exitCode : undefined;
        break;
      case "terminated":
        void this.onExited();
        break;
      case "output":
        this.onOutput(
          String(body.category ?? "console"),
          String(body.output ?? ""),
        );
        break;
      case "breakpoint":
        this.onBreakpointChanged(
          (body.breakpoint ?? {}) as {
            id?: number;
            line?: number;
            column?: number;
            verified?: boolean;
          },
        );
        break;
      case "loadedSource": {
        const source = (body.source ?? {}) as { path?: string };
        if (source.path !== undefined) this.scriptForPath(source.path);
        break;
      }
      default:
        break;
    }
  }

  private onStopped(stopped: DapStoppedEvent): void {
    // Already stopped: a duplicate. Every continue or step sets the state
    // to running first.
    if (this.targetState === "paused") return;
    if (this.internalDepth > 0) {
      this.targetState = "paused";
      const waiter = this.internalWaiters.shift();
      if (waiter !== undefined) waiter(stopped);
      else this.pendingStops.push(stopped);
      return;
    }
    this.targetState = "paused";
    void this.exclusive(async () => {
      if (await this.handleStop(stopped, true)) {
        this.targetState = "running";
        await this.backend.dap.request("continue", {
          threadId: stopped.threadId ?? (await this.threadId()),
        });
        return;
      }
      await this.presentPause(stopped);
    }).catch((error: unknown) => this.log("pause: " + String(error)));
  }

  /** Offers a stop to the plugins' stop handlers; true when one consumed
   * it (the process should continue). */
  private async handleStop(
    stopped: DapStoppedEvent,
    resume: boolean,
  ): Promise<boolean> {
    for (const handler of this.stopHandlers) {
      try {
        if (await handler(stopped, resume)) return true;
      } catch (error) {
        this.log("stop handler: " + String(error));
      }
    }
    return false;
  }

  addStopHandler(
    handler: (stopped: DapStoppedEvent, resume: boolean) => Promise<boolean>,
  ): void {
    this.stopHandlers.push(handler);
  }

  /** Sends the union of the persistent and the operation's function
   * breakpoints; returns the DAP ids of `wanted`, in order. */
  private async syncFunctionBreakpoints(
    wanted: readonly string[],
  ): Promise<number[]> {
    const names = [
      ...new Set([
        ...[...this.persistentFunctions.values()].flat(),
        ...this.functionBreakpointNames,
      ]),
    ];
    const result = await this.backend.dap.request<{
      breakpoints?: { id?: number }[];
    }>("setFunctionBreakpoints", {
      breakpoints: names.map((name) => ({ name })),
    });
    const ids = new Map<string, number>();
    (result.breakpoints ?? []).forEach((entry, index) => {
      const name = names[index];
      if (name !== undefined) ids.set(name, entry.id ?? -1);
    });
    return wanted.map((name) => ids.get(name) ?? -1);
  }

  setPersistentFunctionBreakpoints(
    owner: string,
    names: readonly string[],
  ): Promise<number[]> {
    if (names.length === 0) this.persistentFunctions.delete(owner);
    else this.persistentFunctions.set(owner, names);
    return this.syncFunctionBreakpoints(names);
  }

  private onResumed(): void {
    this.targetState = "running";
    this.pause = undefined;
    void this.emit("Debugger.resumed", {});
  }

  private async onExited(): Promise<void> {
    if (this.targetState === "exited") return;
    const wasPaused = this.pause !== undefined;
    this.targetState = "exited";
    this.pause = undefined;
    for (const waiter of this.internalWaiters.splice(0)) waiter("exited");
    for (const [category] of this.lineBuffers) this.flushLine(category, true);
    if (wasPaused) await this.emit("Debugger.resumed", {});
    this.addConsole(
      "info",
      "Process exited" +
        (this.exitCode === undefined
          ? ""
          : " with status " + String(this.exitCode)),
    );
    await this.emit("Runtime.executionContextDestroyed", {
      executionContextId: contextId,
    });
    for (const plugin of this.plugins) await plugin.dispose?.();
  }

  exitStatus(): number | undefined {
    return this.exitCode;
  }

  private onOutput(category: string, text: string): void {
    // lldb-dap's own messages and command echoes are "console": not the
    // program's output.
    if (category !== "stdout" && category !== "stderr") return;
    const buffered = (this.lineBuffers.get(category) ?? "") + text;
    this.lineBuffers.set(category, buffered);
    this.flushLine(category, false);
  }

  private flushLine(category: string, all: boolean): void {
    let buffered = this.lineBuffers.get(category) ?? "";
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end < 0) break;
      this.addConsole(
        category === "stderr" ? "error" : "log",
        buffered.slice(0, end).replace(/\r$/, ""),
      );
      buffered = buffered.slice(end + 1);
    }
    if (all && buffered !== "") {
      this.addConsole(category === "stderr" ? "error" : "log", buffered);
      buffered = "";
    }
    this.lineBuffers.set(category, buffered);
  }

  private addConsole(type: string, text: string): void {
    const entry = { type, text, timestamp: Date.now() };
    this.consoleHistory.push(entry);
    if (this.consoleHistory.length > 5000) this.consoleHistory.shift();
    if (this.runtimeEnabled) void this.sendConsole(entry);
  }

  private sendConsole(entry: ConsoleEntry): Promise<void> {
    return this.emit("Runtime.consoleAPICalled", {
      type: entry.type,
      args: [{ type: "string", value: entry.text }],
      executionContextId: contextId,
      timestamp: entry.timestamp,
    });
  }

  // ---------------------------------------------------------------------
  // Execution control

  /** Serialises execution-changing work (pauses, steps, operations). */
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const run = this.exclusiveTail.then(body, body);
    this.exclusiveTail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private requireLive(): void {
    if (this.targetState === "exited")
      throw new CdpError(-32000, "the process has exited");
    if (this.targetState === "starting")
      throw new CdpError(-32000, "the process has not started");
  }

  /** The thread to step, pause or continue: the paused one, else the
   * last one seen (adapters such as lldb-dap refuse `threads` while the
   * process runs, and pause/continue the whole process anyway). */
  private async threadId(): Promise<number> {
    if (this.pause !== undefined) return this.pause.threadId;
    if (this.lastThreadId !== undefined) return this.lastThreadId;
    const threads = await this.backend.dap.request<{
      threads?: { id: number }[];
    }>("threads");
    const first = threads.threads?.[0]?.id;
    if (first === undefined) throw new CdpError(-32000, "no threads");
    this.lastThreadId = first;
    return first;
  }

  /** The next stop during an internal operation: a queued one, or the
   * next to arrive within `timeoutMs`. */
  private nextInternalStop(
    timeoutMs: number,
    what: string,
  ): Promise<DapStoppedEvent> {
    const queued = this.pendingStops.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        const index = this.internalWaiters.indexOf(waiter);
        if (index >= 0) this.internalWaiters.splice(index, 1);
        reject(new StopTimeout(what, timeoutMs));
      }, timeoutMs);
      const waiter = (event: DapStoppedEvent | "exited"): void => {
        clearTimeout(timer);
        if (event === "exited")
          reject(new CdpError(-32000, "the process exited"));
        else resolvePromise(event);
      };
      this.internalWaiters.push(waiter);
    });
  }

  /** Stops the running process for an internal operation. A pause sent
   * while the adapter is still resuming the process can be lost, so it
   * is repeated until a stop arrives; a late duplicate stop is queued and
   * discarded before the next continue. */
  private async pauseInternally(threadId: number): Promise<DapStoppedEvent> {
    const deadline = Date.now() + 30000;
    let lastError = "";
    for (;;) {
      const stop = this.nextInternalStop(1000, "pause");
      stop.catch(() => {});
      lastError = await this.backend.dap.request("pause", { threadId }).then(
        () => "",
        (error: unknown) => String(error),
      );
      try {
        return await stop;
      } catch (error) {
        if (!(error instanceof StopTimeout) || Date.now() > deadline)
          throw error instanceof StopTimeout
            ? new CdpError(
                -32000,
                "the process did not stop within 30 s " + lastError,
              )
            : error;
      }
    }
  }

  internal<T>(body: (operation: InternalOperation) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.requireLive();
      const dap = this.backend.dap;
      const userPause = this.pause;
      const threadId = await this.threadId();
      let interrupted: DapStoppedEvent | undefined;
      this.internalDepth++;
      try {
        if (this.targetState === "running") {
          // A stop a handler wants (a sampling stop) is recorded; the
          // process stays stopped for the operation.
          const stopped = await this.pauseInternally(threadId);
          await this.handleStop(stopped, false);
        }
        const operation: InternalOperation = {
          threadId,
          command: (text, timeoutMs) => this.command(text, timeoutMs),
          setFunctionBreakpoints: async (names) => {
            this.functionBreakpointNames = names;
            return this.syncFunctionBreakpoints(names);
          },
          continueToBreakpoint: async (ids, timeoutMs) => {
            const deadline = Date.now() + timeoutMs;
            try {
              for (;;) {
                this.pendingStops.length = 0;
                const stop = this.nextInternalStop(
                  Math.max(1, deadline - Date.now()),
                  "safepoint",
                );
                this.targetState = "running";
                await dap.request("continue", { threadId });
                const stopped = await stop;
                if (
                  (stopped.hitBreakpointIds ?? []).some((id) =>
                    ids.includes(id),
                  )
                )
                  return stopped;
                // Another owner's breakpoint (allocation sampling): handled,
                // then on to the operation's stop.
                if (!(await this.handleStop(stopped, true)))
                  throw new UserStopError(stopped);
              }
            } catch (error) {
              if (!(error instanceof StopTimeout)) throw error;
              await this.pauseInternally(threadId);
              throw new CdpError(
                -32000,
                "no safepoint was reached within " +
                  timeoutMs / 1000 +
                  " s (is the program allocating?)",
              );
            }
          },
        };
        try {
          return await body(operation);
        } catch (error) {
          if (error instanceof UserStopError) interrupted = error.stopped;
          throw error;
        } finally {
          if (this.functionBreakpointNames.length > 0 && this.isLive())
            await operation.setFunctionBreakpoints([]).catch(() => []);
        }
      } finally {
        this.internalDepth--;
        if (this.isLive()) {
          if (interrupted !== undefined) await this.presentPause(interrupted);
          else if (userPause !== undefined)
            await this.presentPause(userPause.stopped, true);
          else {
            this.pendingStops.length = 0;
            this.targetState = "running";
            await dap.request("continue", { threadId }).catch(() => {});
          }
        }
      }
    });
  }

  private isLive(): boolean {
    return this.targetState !== "exited";
  }

  private async presentPause(
    stopped: DapStoppedEvent,
    replay = false,
  ): Promise<void> {
    if (!this.isLive()) return;
    const dap = this.backend.dap;
    this.targetState = "paused";
    const epoch = ++this.epoch;
    const threadId = stopped.threadId ?? (await this.threadId());
    const trace = await dap.request<{ stackFrames?: DapStackFrame[] }>(
      "stackTrace",
      { threadId, startFrame: 0, levels: maxFrames },
    );
    const frameIds = new Map<string, number>();
    const callFrames: object[] = [];
    const all = trace.stackFrames ?? [];
    let first = 0;
    while (
      first < all.length - 1 &&
      this.plugins.some(
        (plugin) => plugin.hideFrame?.(all[first]?.name ?? "") === true,
      )
    )
      first++;
    for (const frame of all.slice(first)) {
      const script =
        frame.source?.path !== undefined &&
        frame.source.sourceReference === undefined
          ? this.scriptForPath(frame.source.path)
          : frame.source?.sourceReference !== undefined
            ? this.scriptForReference(
                frame.source.sourceReference,
                frame.source.path ?? frame.name,
              )
            : undefined;
      if (script !== undefined && !script.announced && this.debuggerEnabled)
        await this.announce(script);
      const scopes = await dap
        .request<{
          scopes?: {
            name: string;
            variablesReference: number;
            presentationHint?: string;
            expensive?: boolean;
          }[];
        }>("scopes", { frameId: frame.id })
        .catch(() => ({ scopes: [] }));
      const callFrameId = epoch + ":" + frame.id;
      frameIds.set(callFrameId, frame.id);
      const location = {
        scriptId: script?.id ?? "0",
        lineNumber: Math.max(0, frame.line - 1),
        columnNumber: Math.max(0, frame.column - 1),
      };
      callFrames.push({
        callFrameId,
        functionName: this.frameName(frame.name),
        location,
        url: script?.url ?? "",
        // Adapters (lldb-dap) reuse scope references for whichever frame
        // was asked last, so a scope's id names its frame and index.
        scopeChain: (scopes.scopes ?? [])
          .map((scope, index) => ({ scope, index }))
          .filter(({ scope }) => scope.variablesReference > 0)
          .map(({ scope, index }) => ({
            type: scopeType(scope.name, scope.presentationHint),
            name: scope.name,
            object: {
              type: "object",
              className: "Object",
              description: scope.name,
              objectId: "scope:" + epoch + ":" + frame.id + ":" + index,
            },
          })),
        this: { type: "undefined" },
        canBeRestarted: false,
      });
    }
    const crashed = isCrash(stopped);
    this.pause = {
      epoch,
      threadId,
      stopped,
      callFrames,
      frameIds,
    };
    if (crashed && !replay)
      this.addConsole(
        "error",
        "Paused on " + (stopped.description ?? stopped.text ?? "exception"),
      );
    await this.sendPaused();
  }

  private async sendPaused(): Promise<void> {
    const pause = this.pause;
    if (pause === undefined || !this.debuggerEnabled) return;
    const stopped = pause.stopped;
    const hit: string[] = [];
    for (const dapId of stopped.hitBreakpointIds ?? []) {
      const entry = this.dapBreakpoints.get(dapId);
      if (entry !== undefined && !hit.includes(entry.breakpoint))
        hit.push(entry.breakpoint);
    }
    const crashed = isCrash(stopped);
    await this.emit("Debugger.paused", {
      callFrames: pause.callFrames,
      reason: crashed ? "exception" : "other",
      ...(crashed
        ? {
            data: {
              type: "object",
              className: "Error",
              description: stopped.description ?? stopped.text ?? "exception",
            },
          }
        : {}),
      hitBreakpoints: hit,
    });
  }

  frameName(name: string): string {
    let result = name;
    for (const plugin of this.plugins)
      if (plugin.frameName !== undefined) result = plugin.frameName(result);
    return result;
  }

  private objectId(epoch: number, reference: number): string {
    return "dap:" + epoch + ":" + reference;
  }

  private async execution(
    command: "continue" | "next" | "stepIn" | "stepOut",
  ): Promise<void> {
    await this.exclusive(async () => {
      this.requireLive();
      if (this.pause === undefined) {
        if (command === "continue") return;
        throw new CdpError(-32000, "Can only perform operation while paused.");
      }
      const threadId = this.pause.threadId;
      this.targetState = "running";
      this.pause = undefined;
      await this.backend.dap.request(command, {
        threadId,
        ...(command === "continue" ? {} : { granularity: "line" }),
      });
      await this.emit("Debugger.resumed", {});
    });
  }

  // ---------------------------------------------------------------------
  // Breakpoints

  private pathsFor(breakpoint: Breakpoint): string[] {
    const paths = new Set<string>();
    for (const script of this.scriptsByDapPath.values()) {
      if (script.dapPath === undefined) continue;
      if (
        (breakpoint.url !== undefined && script.url === breakpoint.url) ||
        (breakpoint.urlRegex !== undefined &&
          breakpoint.urlRegex.test(script.url))
      )
        paths.add(script.dapPath);
    }
    if (paths.size === 0 && breakpoint.url !== undefined) {
      // Not (yet) in the line tables: let the adapter resolve the path.
      paths.add(
        breakpoint.url.startsWith("file:")
          ? fileURLToPath(breakpoint.url)
          : breakpoint.url,
      );
    }
    return [...paths];
  }

  private async syncBreakpoints(path: string): Promise<void> {
    const list = this.breakpointsActive
      ? [...this.breakpoints.values()].filter((breakpoint) =>
          this.pathsFor(breakpoint).includes(path),
        )
      : [];
    if (list.length === 0 && !this.syncedPaths.has(path)) return;
    this.syncedPaths.add(path);
    const result = await this.backend.dap.request<{
      breakpoints?: {
        id?: number;
        verified?: boolean;
        line?: number;
        column?: number;
      }[];
    }>("setBreakpoints", {
      source: { path },
      breakpoints: list.map((breakpoint) => ({
        line: breakpoint.line + 1,
        ...(breakpoint.column === undefined || breakpoint.column === 0
          ? {}
          : { column: breakpoint.column + 1 }),
        ...(breakpoint.condition === undefined || breakpoint.condition === ""
          ? {}
          : { condition: breakpoint.condition }),
      })),
    });
    for (const [dapId, entry] of this.dapBreakpoints)
      if (entry.path === path) this.dapBreakpoints.delete(dapId);
    (result.breakpoints ?? []).forEach((resolved, index) => {
      const breakpoint = list[index];
      if (breakpoint === undefined) return;
      if (resolved.id !== undefined)
        this.dapBreakpoints.set(resolved.id, {
          breakpoint: breakpoint.id,
          path,
        });
      breakpoint.locations.set(path, {
        line: (resolved.line ?? breakpoint.line + 1) - 1,
        column: Math.max(0, (resolved.column ?? 1) - 1),
        verified: resolved.verified === true,
      });
    });
  }

  private locationsOf(breakpoint: Breakpoint): object[] {
    const locations: object[] = [];
    for (const [path, location] of breakpoint.locations) {
      if (!location.verified) continue;
      const script =
        this.scriptsByDapPath.get(path) ?? this.scriptForPath(path);
      if (!script.announced && this.debuggerEnabled) void this.announce(script);
      locations.push({
        scriptId: script.id,
        lineNumber: location.line,
        columnNumber: location.column,
      });
    }
    return locations;
  }

  private onBreakpointChanged(changed: {
    id?: number;
    line?: number;
    column?: number;
    verified?: boolean;
  }): void {
    if (changed.id === undefined) return;
    const entry = this.dapBreakpoints.get(changed.id);
    if (entry === undefined) return;
    const breakpoint = this.breakpoints.get(entry.breakpoint);
    if (breakpoint === undefined) return;
    const before = breakpoint.locations.get(entry.path);
    const location = {
      line: (changed.line ?? (before?.line ?? 0) + 1) - 1,
      column: Math.max(0, (changed.column ?? (before?.column ?? 0) + 1) - 1),
      verified: changed.verified === true,
    };
    breakpoint.locations.set(entry.path, location);
    if (location.verified && before?.verified !== true) {
      const script = this.scriptForPath(entry.path);
      void this.emit("Debugger.breakpointResolved", {
        breakpointId: breakpoint.id,
        location: {
          scriptId: script.id,
          lineNumber: location.line,
          columnNumber: location.column,
        },
      });
    }
  }

  private async addBreakpoint(spec: {
    url?: string;
    urlRegex?: string;
    line: number;
    column?: number;
    condition?: string;
  }): Promise<Breakpoint> {
    const breakpoint: Breakpoint = {
      id:
        String(this.nextBreakpointId++) +
        ":" +
        spec.line +
        ":" +
        (spec.column ?? 0),
      url: spec.url,
      urlRegex:
        spec.urlRegex === undefined ? undefined : new RegExp(spec.urlRegex),
      line: spec.line,
      column: spec.column,
      condition: spec.condition,
      locations: new Map(),
    };
    this.breakpoints.set(breakpoint.id, breakpoint);
    for (const path of this.pathsFor(breakpoint))
      await this.syncBreakpoints(path);
    return breakpoint;
  }

  // ---------------------------------------------------------------------
  // Variables

  /** The DAP variables reference of an object id: a variable's, or a
   * scope's (re-requested for its frame). */
  private async referenceOf(objectId: unknown): Promise<number> {
    const match =
      typeof objectId === "string"
        ? /^(dap|scope):(\d+):(\d+)(?::(\d+))?$/.exec(objectId)
        : null;
    if (match === null) throw new CdpError(-32000, "Invalid remote object id");
    if (Number(match[2]) !== this.pause?.epoch)
      throw new CdpError(
        -32000,
        "Could not find object with given id (the process has resumed)",
      );
    if (match[1] === "dap") return Number(match[3]);
    const scopes = await this.backend.dap.request<{
      scopes?: { variablesReference: number }[];
    }>("scopes", { frameId: Number(match[3]) });
    const scope = scopes.scopes?.[Number(match[4])];
    if (scope === undefined) throw new CdpError(-32000, "No such scope");
    return scope.variablesReference;
  }

  private remoteObject(variable: DapVariable): RemoteObject | null {
    const epoch = this.pause?.epoch ?? 0;
    const objectId =
      variable.variablesReference > 0
        ? this.objectId(epoch, variable.variablesReference)
        : undefined;
    for (const plugin of this.plugins) {
      const formatted = plugin.formatVariable?.(variable, objectId);
      if (formatted !== undefined) return formatted;
    }
    return genericRemoteObject(variable, objectId);
  }

  private propertyName(variable: DapVariable): string {
    for (const plugin of this.plugins) {
      const name = plugin.propertyName?.(variable);
      if (name !== undefined) return name;
    }
    return propertyNameOf(variable.name);
  }

  private async properties(reference: number): Promise<object[]> {
    const result = await this.backend.dap.request<{
      variables?: DapVariable[];
    }>("variables", { variablesReference: reference });
    const properties: object[] = [];
    for (const variable of result.variables ?? []) {
      const value = this.remoteObject(variable);
      if (value === null) continue;
      properties.push({
        name: this.propertyName(variable),
        value,
        writable: false,
        configurable: false,
        enumerable: true,
        isOwn: true,
      });
    }
    return properties;
  }

  /** A plain variable path (`a`, `a.b`, `a[0]`) on a paused frame, read
   * through DAP variables: nothing runs in the process. */
  private async variablePath(
    callFrameId: string,
    expression: string,
  ): Promise<RemoteObject> {
    const frameId = this.pause?.frameIds.get(callFrameId);
    if (frameId === undefined)
      throw new CdpError(-32000, "Could not find call frame with given id");
    const parts = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(
      expression.trim(),
    )
      ? (expression.trim().match(/[A-Za-z_$][\w$]*|\d+/g) ?? [])
      : undefined;
    if (parts === undefined || parts.length === 0)
      throw notSupported("Evaluating expressions (phase 2)");
    const dap = this.backend.dap;
    const scopes = await dap.request<{
      scopes?: { name: string; variablesReference: number }[];
    }>("scopes", { frameId });
    let candidates: DapVariable[] = [];
    for (const scope of scopes.scopes ?? []) {
      if (/^registers$/i.test(scope.name)) continue;
      const variables = await dap.request<{ variables?: DapVariable[] }>(
        "variables",
        { variablesReference: scope.variablesReference },
      );
      candidates = candidates.concat(variables.variables ?? []);
      if (candidates.some((variable) => variable.name === parts[0])) break;
    }
    let current: DapVariable | undefined;
    for (const part of parts) {
      current = candidates.find(
        (variable) =>
          this.propertyName(variable) === part || variable.name === part,
      );
      if (current === undefined)
        throw new CdpError(-32000, part + " is not defined");
      if (part === parts[parts.length - 1]) break;
      if (current.variablesReference === 0)
        throw new CdpError(
          -32000,
          "Cannot read properties of " + current.value,
        );
      candidates =
        (
          await dap.request<{ variables?: DapVariable[] }>("variables", {
            variablesReference: current.variablesReference,
          })
        ).variables ?? [];
    }
    if (current === undefined) throw new CdpError(-32000, "not defined");
    return this.remoteObject(current) ?? { type: "undefined" };
  }

  // ---------------------------------------------------------------------
  // Methods

  private on(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  private registerCoreMethods(): void {
    const ok = async (): Promise<object> => ({});
    // Debugger
    this.on("Debugger.enable", async () => {
      this.debuggerEnabled = true;
      for (const script of this.scripts.values())
        if (!script.announced) await this.announce(script);
      if (this.pause !== undefined) await this.sendPaused();
      return { debuggerId: "tint-native-" + this.targetId };
    });
    this.on("Debugger.disable", async () => {
      this.debuggerEnabled = false;
      return {};
    });
    for (const method of [
      "Debugger.setPauseOnExceptions",
      "Debugger.setAsyncCallStackDepth",
      "Debugger.setBlackboxPatterns",
      "Debugger.setBlackboxedRanges",
      "Debugger.setBlackboxExecutionContexts",
      "Debugger.setSkipAllPauses",
    ])
      this.on(method, ok);
    this.on("Debugger.getScriptSource", async (params) => {
      const script = this.scripts.get(String(params.scriptId));
      if (script === undefined) throw new CdpError(-32000, "No script for id");
      if (script.source === undefined && script.sourceReference !== undefined) {
        const result = await this.backend.dap.request<{ content?: string }>(
          "source",
          { sourceReference: script.sourceReference },
        );
        script.source = result.content ?? "";
      }
      if (script.source === undefined && script.diskPath !== undefined)
        script.source = readFileSync(script.diskPath, "utf8");
      return {
        scriptSource:
          script.source ??
          "// Source not available: " +
            (script.dapPath ?? script.url) +
            "\n// Pass --source-root or --source-map to the DevTools bridge.\n",
      };
    });
    this.on("Debugger.setBreakpointByUrl", async (params) => {
      if (
        params.url === undefined &&
        params.urlRegex === undefined &&
        params.scriptHash === undefined
      )
        throw new CdpError(-32602, "Either url or urlRegex must be specified.");
      if (params.scriptHash !== undefined && params.url === undefined)
        throw notSupported("Breakpoints by script hash");
      const breakpoint = await this.addBreakpoint({
        line: Number(params.lineNumber ?? 0),
        ...(params.url === undefined ? {} : { url: String(params.url) }),
        ...(params.urlRegex === undefined
          ? {}
          : { urlRegex: String(params.urlRegex) }),
        ...(params.columnNumber === undefined
          ? {}
          : { column: Number(params.columnNumber) }),
        ...(params.condition === undefined
          ? {}
          : { condition: String(params.condition) }),
      });
      return {
        breakpointId: breakpoint.id,
        locations: this.locationsOf(breakpoint),
      };
    });
    this.on("Debugger.setBreakpoint", async (params) => {
      const location = (params.location ?? {}) as {
        scriptId?: string;
        lineNumber?: number;
        columnNumber?: number;
      };
      const script = this.scripts.get(String(location.scriptId));
      if (script === undefined || script.dapPath === undefined)
        throw new CdpError(-32000, "Could not resolve breakpoint");
      const breakpoint = await this.addBreakpoint({
        url: script.url,
        line: Number(location.lineNumber ?? 0),
        ...(location.columnNumber === undefined
          ? {}
          : { column: location.columnNumber }),
        ...(params.condition === undefined
          ? {}
          : { condition: String(params.condition) }),
      });
      const actual = this.locationsOf(breakpoint)[0];
      if (actual === undefined)
        throw new CdpError(-32000, "Could not resolve breakpoint");
      return { breakpointId: breakpoint.id, actualLocation: actual };
    });
    this.on("Debugger.removeBreakpoint", async (params) => {
      const breakpoint = this.breakpoints.get(String(params.breakpointId));
      if (breakpoint === undefined) return {};
      const paths = this.pathsFor(breakpoint);
      this.breakpoints.delete(breakpoint.id);
      for (const path of paths) await this.syncBreakpoints(path);
      return {};
    });
    this.on("Debugger.setBreakpointsActive", async (params) => {
      this.breakpointsActive = params.active !== false;
      for (const path of [...this.syncedPaths])
        await this.syncBreakpoints(path);
      for (const breakpoint of this.breakpoints.values())
        for (const path of this.pathsFor(breakpoint))
          await this.syncBreakpoints(path);
      return {};
    });
    this.on("Debugger.getPossibleBreakpoints", async (params) => {
      const start = (params.start ?? {}) as {
        scriptId?: string;
        lineNumber?: number;
      };
      const end = params.end as { lineNumber?: number } | undefined;
      const script = this.scripts.get(String(start.scriptId));
      if (script?.dapPath === undefined) return { locations: [] };
      const line = Number(start.lineNumber ?? 0) + 1;
      const result = await this.backend.dap
        .request<{ breakpoints?: { line: number; column?: number }[] }>(
          "breakpointLocations",
          {
            source: { path: script.dapPath },
            line,
            ...(end?.lineNumber === undefined
              ? {}
              : { endLine: Math.max(line, end.lineNumber) }),
          },
        )
        .catch(() => ({ breakpoints: [] }));
      return {
        locations: (result.breakpoints ?? []).map((location) => ({
          scriptId: script.id,
          lineNumber: location.line - 1,
          columnNumber: Math.max(0, (location.column ?? 1) - 1),
        })),
      };
    });
    this.on("Debugger.pause", async () => {
      await this.exclusive(async () => {
        this.requireLive();
        const threadId = await this.threadId();
        // A pause sent while the adapter is still resuming can be lost:
        // repeat it until the process stops (Debugger.paused follows).
        let lastError = "";
        for (let attempt = 0; attempt < 30; attempt++) {
          if (this.targetState !== "running") return;
          lastError = await this.backend.dap
            .request("pause", { threadId })
            .then(
              () => "",
              (error: unknown) => String(error),
            );
          for (let waited = 0; waited < 1000; waited += 50) {
            if (this.targetState !== "running") return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        throw new CdpError(
          -32000,
          "Debugger.pause: the process did not stop within 30 s " + lastError,
        );
      });
      return {};
    });
    this.on("Debugger.resume", async () => {
      await this.execution("continue");
      return {};
    });
    this.on("Debugger.stepOver", async () => {
      await this.execution("next");
      return {};
    });
    this.on("Debugger.stepInto", async () => {
      await this.execution("stepIn");
      return {};
    });
    this.on("Debugger.stepOut", async () => {
      await this.execution("stepOut");
      return {};
    });
    this.on("Debugger.evaluateOnCallFrame", async (params) => ({
      result: await this.variablePath(
        String(params.callFrameId),
        String(params.expression ?? ""),
      ),
    }));

    // Runtime
    this.on("Runtime.enable", async () => {
      this.runtimeEnabled = true;
      await this.emit("Runtime.executionContextCreated", {
        context: {
          id: contextId,
          origin: "",
          name: this.program ?? "native process",
          uniqueId: "tint-native-" + this.targetId,
          auxData: { isDefault: true },
        },
      });
      for (const entry of this.consoleHistory) await this.sendConsole(entry);
      if (this.targetState === "exited")
        await this.emit("Runtime.executionContextDestroyed", {
          executionContextId: contextId,
        });
      return {};
    });
    this.on("Runtime.disable", async () => {
      this.runtimeEnabled = false;
      return {};
    });
    this.on("Runtime.runIfWaitingForDebugger", async () => {
      await this.configurationDone?.();
      return {};
    });
    this.on("Runtime.getIsolateId", async () => ({
      id: "tint-native-" + this.targetId,
    }));
    this.on("Runtime.getProperties", async (params) => {
      if (params.accessorPropertiesOnly === true) return { result: [] };
      return {
        result: await this.properties(await this.referenceOf(params.objectId)),
      };
    });
    for (const method of [
      "Runtime.releaseObject",
      "Runtime.releaseObjectGroup",
      "Runtime.discardConsoleEntries",
      "Runtime.setAsyncCallStackDepth",
      "Runtime.addBinding",
      "Console.enable",
      "Console.disable",
      "Console.clearMessages",
    ])
      this.on(method, ok);
    for (const method of [
      "Runtime.evaluate",
      "Runtime.callFunctionOn",
      "Runtime.compileScript",
      "Runtime.runScript",
      "Runtime.queryObjects",
      "Runtime.globalLexicalScopeNames",
    ])
      this.on(method, async () => {
        throw notSupported(method + " (expression evaluation is phase 2)");
      });
    for (const method of [
      "Debugger.setVariableValue",
      "Debugger.setScriptSource",
      "Debugger.restartFrame",
      "Debugger.continueToLocation",
      "Debugger.setReturnValue",
      "Debugger.searchInContent",
      "Debugger.setInstrumentationBreakpoint",
    ])
      this.on(method, async () => {
        throw notSupported(method);
      });
    this.on("Schema.getDomains", async () => ({
      domains: [
        ...new Set(this.methods().map((name) => name.split(".")[0])),
      ].map((name) => ({ name, version: "1.3" })),
    }));
  }

  /** Ends the session: kills a launched process, detaches from an
   * attached one, and stops the adapter. */
  async close(): Promise<void> {
    const dap = this.backend.dap;
    if (dap.running)
      await dap
        .request(
          "disconnect",
          { terminateDebuggee: this.options.attachPid === undefined },
          10000,
        )
        .catch(() => {});
    this.backend.close();
    for (const plugin of this.plugins) await plugin.dispose?.();
    rmSync(this.workDirectory, { recursive: true, force: true });
  }
}

/** A fault (not a pause request) stopped the process. */
function isCrash(stopped: DapStoppedEvent): boolean {
  return (
    stopped.reason === "exception" &&
    !/SIGSTOP|signal SIGINT/.test(stopped.description ?? "")
  );
}

function scopeType(name: string, hint: string | undefined): string {
  if (hint === "locals" || /^locals?$/i.test(name)) return "local";
  if (/^globals?$/i.test(name)) return "global";
  if (hint === "arguments" || /^arguments$/i.test(name)) return "local";
  return "block";
}
