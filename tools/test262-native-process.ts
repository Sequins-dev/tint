import {
  debugserverLaunchCommand,
  debuggerTraceCommands,
  cleanupDebuggerSession,
  readDebuggerSessionLogs,
} from "./native-debugger-session.ts";
import { spawnSync } from "node:child_process";
import { gateLaunch } from "./gate/lock.ts";
import {
  mkdtempSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
  rmSync,
  chmodSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeNodeBytes } from "./node-file-host.ts";
import type { ExecutionOutcome } from "./test262-execution.ts";
import { nativeExitOutcome, nativeTestResources } from "./test262-native.ts";
import type { NativeResult } from "./native-target-runner.ts";

export function nativeTransportOutcome(result: NativeResult): ExecutionOutcome {
  switch (result.kind) {
    case "exited":
      return nativeExitOutcome(result.status);
    case "timed-out":
      return { kind: "timeout", detail: "native timeout after launch" };
    case "signaled":
      return {
        kind: "crash",
        detail: "native process terminated by " + result.signal,
      };
    case "execution-unavailable":
    case "runner-error":
      return { kind: "crash", detail: "launch: " + result.reason };
  }
}

/** Match the debugger to the Darwin debugserver shipped by the host toolchain. */
export const nativeDebuggerExecutable =
  process.platform === "darwin" ? "/usr/bin/lldb" : "lldb";
export const nativeDebuggerTracing =
  process.env.TINT_TEST262_DEBUGGER_TRACE === "1";
export const nativeExecutableWriteback = "atomic-rename-after-fsync";
export function selectNativeDebuggerLaunch(
  platform: string,
  requested: string | undefined,
):
  | "process"
  | "debugserver-direct"
  | "debugserver-connected"
  | "lldb-local"
  | "lldb-local-stdio" {
  // A plain child process: its exit status or terminating signal is the
  // outcome. A debugger session costs about two seconds per variant, more
  // than compiling it in a large batch; the debugger modes remain for
  // diagnosing faults. (Direct debugserver launch establishes the initial
  // stop before LLDB connects; the connected protocol still misses
  // initial-stop events intermittently.)
  if (requested === undefined || requested === "process") return "process";
  if (
    requested !== "lldb-local" &&
    requested !== "lldb-local-stdio" &&
    requested !== "debugserver-direct" &&
    requested !== "debugserver-connected"
  )
    throw new Error("invalid native debugger launch mode");
  if (
    (requested === "debugserver-direct" ||
      requested === "debugserver-connected") &&
    platform !== "darwin"
  )
    throw new Error("direct debugserver launch requires Darwin");
  return requested;
}
export const nativeDebuggerLaunch = selectNativeDebuggerLaunch(
  process.platform,
  process.env.TINT_TEST262_DEBUGGER_LAUNCH,
);
export const nativeDebuggerStdio =
  nativeDebuggerLaunch === "lldb-local-stdio" ? "debugger-managed" : "disabled";
/** Completion is accepted only after an independently recorded initial stopped state. */
export function nativeDebuggerInitialState(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "state" in value &&
    value.state === "stopped" &&
    "pid" in value &&
    typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0
  );
}
export function nativeDebuggerOutcome(value: unknown): ExecutionOutcome {
  if (
    value !== null &&
    typeof value === "object" &&
    "state" in value &&
    value.state === "exited" &&
    "exitStatus" in value &&
    typeof value.exitStatus === "number" &&
    Number.isInteger(value.exitStatus)
  )
    return nativeExitOutcome(value.exitStatus);
  return {
    kind: "crash",
    detail:
      "native process did not terminate normally: " + JSON.stringify(value),
  };
}

/** A batch image's case argument: an index, or a linked-unit case descriptor
 * (digits, ':' and ',' only, so it passes unquoted through LLDB). */
export type NativeCaseSelector = number | string;
function validCaseSelector(selector: NativeCaseSelector): boolean {
  return typeof selector === "number"
    ? Number.isSafeInteger(selector) && selector >= 0
    : /^[0-9][0-9:,]{0,4095}$/.test(selector);
}
/** The result of an image's first launch. */
export type NativeAdmission =
  | { readonly admitted: true; readonly admissionMs: number }
  | {
      readonly admitted: false;
      readonly admissionMs: number;
      readonly outcome: ExecutionOutcome;
    };
/** Launches a newly published image once, with no case argument, so the host
 * admits the executable file before any case's execution budget starts.
 * macOS assesses each new executable file on its first exec in one host-wide
 * serial queue (about 16 ms per MiB of image plus a fixed cost, so
 * concurrent builds can delay a launch by minutes); later launches of the
 * same file start immediately. Without a case argument every batch host
 * exits 99 after runtime initialization, so no test code runs. Any exit or
 * signal means the process ran and the file is admitted; a fault during
 * initialization recurs, and is reported, in each case's own launch.
 * Exceeding `timeoutMs` (a host stall, not a test outcome) or failing to spawn
 * at all is returned as the outcome of every case. */
export function admitNativeFile(
  binary: string,
  timeoutMs: number,
): NativeAdmission {
  if (process.env.TINT_GATE_LAUNCH_LOCK)
    return gateLaunch<NativeAdmission>(
      "test262-admission",
      import.meta.filename,
      ["admit", binary, String(timeoutMs)],
    );
  return admitUnlocked(binary, timeoutMs);
}
function admitUnlocked(binary: string, timeoutMs: number): NativeAdmission {
  const started = performance.now();
  const result = spawnSync(binary, [], {
    stdio: "ignore",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const admissionMs = performance.now() - started;
  if (result.error === undefined) return { admitted: true, admissionMs };
  return {
    admitted: false,
    admissionMs,
    outcome:
      "code" in result.error && result.error.code === "ETIMEDOUT"
        ? {
            kind: "timeout",
            detail:
              "native image was not admitted: its first launch did not complete within " +
              timeoutMs +
              " ms; no case was executed",
          }
        : {
            kind: "crash",
            detail: "native image admission launch: " + result.error.message,
          },
  };
}
/** One staged executable can serve many isolated inferior processes. The
 * first run (or an explicit `admit`) performs launch admission; each run's
 * own timeout then measures only that case's launch and execution. */
export class NativeImageRunner {
  readonly path: string;
  #directory: string;
  #timeoutMs: number;
  #admissionTimeoutMs: number;
  #admission: NativeAdmission | undefined;
  #closed = false;
  constructor(
    bytes: Uint8Array,
    timeoutMs: number,
    admissionTimeoutMs: number = nativeTestResources.admissionTimeoutMs,
  ) {
    this.#directory = mkdtempSync(join(tmpdir(), "tint-test262-image-"));
    this.path = join(this.#directory, "test");
    this.#timeoutMs = timeoutMs;
    this.#admissionTimeoutMs = admissionTimeoutMs;
    try {
      // Keep the launch path unpublished until bytes and permissions are complete.
      const staging = join(this.#directory, ".image");
      const descriptor = openSync(staging, "wx", 0o600);
      try {
        writeNodeBytes(descriptor, bytes);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      chmodSync(staging, 0o755);
      renameSync(staging, this.path);
    } catch (error) {
      rmSync(this.#directory, { recursive: true, force: true });
      throw error;
    }
  }
  /** Admits the image once; later calls return the first result. */
  admit(): NativeAdmission {
    if (this.#closed) throw new Error("native image runner is closed");
    this.#admission ??= admitNativeFile(this.path, this.#admissionTimeoutMs);
    return this.#admission;
  }
  run(
    selectedCase?: NativeCaseSelector,
    waiting?: (phase: string) => void,
  ): ExecutionOutcome {
    if (this.#closed) throw new Error("native image runner is closed");
    if (selectedCase !== undefined && !validCaseSelector(selectedCase))
      throw new Error("invalid native batch selector");
    if (this.#admission === undefined) waiting?.("admitting image");
    const admission = this.admit();
    if (!admission.admitted) return admission.outcome;
    return executeNativeFile(this.path, this.#timeoutMs, selectedCase, waiting);
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    rmSync(this.#directory, { recursive: true, force: true });
  }
}
export function executeNativeImage(
  bytes: Uint8Array,
  timeoutMs: number,
  selectedCase?: NativeCaseSelector,
): ExecutionOutcome {
  const image = new NativeImageRunner(bytes, timeoutMs);
  try {
    return image.run(selectedCase);
  } finally {
    image.close();
  }
}
/** Execute a caller-owned, already published artifact without rewriting it.
 * The caller owns its integrity, execution checkpoint and eventual cleanup.
 * Use a debugger-owned side file, never program stdout, as the result protocol.
 * A stopped fault remains contained in LLDB and is killed before debugger exit. */
export function executeNativeFile(
  binary: string,
  timeoutMs: number,
  selectedCase?: NativeCaseSelector,
  waiting?: (phase: string) => void,
): ExecutionOutcome {
  if (selectedCase !== undefined && !validCaseSelector(selectedCase))
    throw new Error("invalid native batch selector");
  if (process.env.TINT_GATE_LAUNCH_LOCK) {
    const label =
      nativeDebuggerLaunch === "process" ? "test262-run" : "test262-debugger";
    waiting?.("waiting for the exclusive gate launch");
    return gateLaunch<ExecutionOutcome>(label, import.meta.filename, [
      "execute",
      binary,
      String(timeoutMs),
      JSON.stringify(selectedCase ?? null),
    ]);
  }
  if (nativeDebuggerLaunch === "process") {
    waiting?.("running");
    return executeNativeProcess(binary, timeoutMs, selectedCase);
  }
  return executeNativeDebugger(binary, timeoutMs, selectedCase, waiting);
}
function executeNativeDebugger(
  binary: string,
  timeoutMs: number,
  selectedCase?: NativeCaseSelector,
  waiting?: (phase: string) => void,
): ExecutionOutcome {
  const directory = mkdtempSync(join(tmpdir(), "tint-test262-"));
  const report = join(directory, "outcome.json"),
    pidFile = join(directory, "pid"),
    initialFile = join(directory, "initial.json");
  const processExpression = "lldb.debugger.GetSelectedTarget().GetProcess()";
  const savePid = `script import json; p=${processExpression}; open(${JSON.stringify(pidFile)},'w').write(str(p.GetProcessID())); open(${JSON.stringify(initialFile)},'w').write(json.dumps({'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`;
  const saveResult = `script import json; p=${processExpression}; s=p.GetState(); open(${JSON.stringify(report)},'w').write(json.dumps({'state':'exited' if s==lldb.eStateExited else str(s),'exitStatus':p.GetExitStatus(),'stopDescription':p.GetSelectedThread().GetStopDescription(512) if s!=lldb.eStateExited else None})); p.Kill() if s!=lldb.eStateExited else None`;
  const localLaunch =
    nativeDebuggerLaunch === "lldb-local" ||
    nativeDebuggerLaunch === "lldb-local-stdio";
  const launch = !localLaunch
    ? debugserverLaunchCommand(
        binary,
        directory,
        selectedCase === undefined ? [] : [String(selectedCase)],
        timeoutMs,
        nativeDebuggerLaunch === "debugserver-connected"
          ? "connected"
          : "direct",
      )
    : (nativeDebuggerLaunch === "lldb-local-stdio"
        ? "process launch --stop-at-entry"
        : "process launch --no-stdio --stop-at-entry") +
      (selectedCase === undefined ? "" : " -- " + selectedCase);

  const isolatedGroup = localLaunch && process.platform !== "win32";
  let debuggerGroup: number | undefined;
  try {
    // Result files are independent of stdout for both launch protocols.
    const spawnOptions = {
      encoding: "utf8" as const,
      detached: isolatedGroup,
      timeout: timeoutMs,
      killSignal: "SIGKILL" as const,
      maxBuffer: 1024 * 1024,
    };
    waiting?.("launching debugger / awaiting LLDB");
    const result = spawnSync(
      nativeDebuggerExecutable,
      [
        "--no-lldbinit",
        "--batch",
        "-o",
        "settings set target.disable-aslr false",
        ...(nativeDebuggerTracing
          ? debuggerTraceCommands(directory).flatMap((command) => [
              "-o",
              command,
            ])
          : []),
        "-o",
        launch,
        "-o",
        savePid,
        "-o",
        "continue",
        "-o",
        saveResult,
        binary,
      ],
      spawnOptions,
    );
    if (isolatedGroup && result.pid > 0) debuggerGroup = result.pid;
    const diagnostic = (): string => {
      return (
        result.stderr.slice(-4096) +
        "\nLLDB stdout: " +
        result.stdout.slice(-8192) +
        readDebuggerSessionLogs(directory)
      );
    };
    if (result.error !== undefined) {
      // Cleanup below includes the private stub and any pre-handshake inferior.
      if ("code" in result.error && result.error.code === "ETIMEDOUT") {
        let began = false;
        try {
          began = nativeDebuggerInitialState(
            JSON.parse(readFileSync(initialFile, "utf8")),
          );
        } catch {}
        return {
          kind: "timeout",
          detail:
            "native timeout " +
            (began ? "after" : "before") +
            " the initial stop\n" +
            diagnostic(),
        };
      }
      return { kind: "crash", detail: "LLDB adapter: " + result.error.message };
    }
    try {
      const initial = JSON.parse(readFileSync(initialFile, "utf8"));
      if (!nativeDebuggerInitialState(initial))
        return {
          kind: "crash",
          detail:
            "LLDB did not confirm the initial stopped state: " +
            JSON.stringify(initial) +
            "\n" +
            diagnostic(),
        };
      return nativeDebuggerOutcome(JSON.parse(readFileSync(report, "utf8")));
    } catch {
      return {
        kind: "crash",
        detail: "LLDB did not produce a result: " + diagnostic(),
      };
    }
  } finally {
    // A failed local launch can precede the PID handoff. Its private process
    // group contains only this debugger session, including its owned stub.
    if (debuggerGroup !== undefined) {
      try {
        process.kill(-debuggerGroup, "SIGKILL");
      } catch {}
    }
    cleanupDebuggerSession(directory);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run an image as a plain child process, without a debugger. Its output is
 * discarded, as under the debugger; the exit status maps through the native
 * result protocol, a terminating signal is a crash, and an overrun is killed
 * and reported as a timeout. */
export function executeNativeProcess(
  binary: string,
  timeoutMs: number,
  selectedCase?: NativeCaseSelector,
): ExecutionOutcome {
  const result = spawnSync(
    binary,
    selectedCase === undefined ? [] : [String(selectedCase)],
    { stdio: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" },
  );
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ETIMEDOUT")
      return { kind: "timeout", detail: "native timeout after launch" };
    return { kind: "crash", detail: "launch: " + result.error.message };
  }
  if (result.signal !== null)
    return {
      kind: "crash",
      detail: "native process terminated by " + result.signal,
    };
  if (result.status === null)
    return { kind: "crash", detail: "native process reported no status" };
  return nativeExitOutcome(result.status);
}

/** Append evidence as it arrives; absence of a completion record means incomplete. */
export { createNativeRunJournal } from "./native-run-journal.ts";

if (import.meta.main) {
  const [mode, binary, timeout, selector] = process.argv.slice(2);
  if (!binary || !timeout || (mode !== "admit" && mode !== "execute"))
    throw Error("Expected a native gate launch command");
  const timeoutMs = Number(timeout);
  delete process.env.TINT_GATE_LAUNCH_LOCK;
  const result =
    mode === "admit"
      ? admitNativeFile(binary, timeoutMs)
      : executeNativeFile(
          binary,
          timeoutMs,
          JSON.parse(selector ?? "null") ?? undefined,
        );
  console.log(JSON.stringify(result));
}
