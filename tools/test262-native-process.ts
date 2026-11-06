import {
  debugserverLaunchCommand,
  debuggerTraceCommands,
  cleanupDebuggerSession,
  readDebuggerSessionLogs,
} from "./native-debugger-session.ts";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecutionOutcome } from "./test262-execution.ts";
import { nativeExitOutcome } from "./test262-native.ts";

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
  | "debugserver-direct"
  | "debugserver-connected"
  | "lldb-local"
  | "lldb-local-stdio" {
  if (requested === undefined)
    return platform === "darwin" ? "debugserver-connected" : "lldb-local";
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

/** One staged executable can serve many isolated inferior processes. */
export class NativeImageRunner {
  readonly path: string;
  #directory: string;
  #timeoutMs: number;
  #closed = false;
  constructor(bytes: Uint8Array, timeoutMs: number) {
    this.#directory = mkdtempSync(join(tmpdir(), "tint-test262-image-"));
    this.path = join(this.#directory, "test");
    this.#timeoutMs = timeoutMs;
    try {
      // Keep the launch path unpublished until bytes and permissions are complete.
      const staging = join(this.#directory, ".image");
      const descriptor = openSync(staging, "wx", 0o600);
      try {
        writeFileSync(descriptor, bytes);
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
  run(
    selectedCase?: number,
    waiting?: (phase: string) => void,
  ): ExecutionOutcome {
    if (this.#closed) throw new Error("native image runner is closed");
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
  selectedCase?: number,
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
  selectedCase?: number,
  waiting?: (phase: string) => void,
): ExecutionOutcome {
  if (
    selectedCase !== undefined &&
    (!Number.isSafeInteger(selectedCase) || selectedCase < 0)
  )
    throw new Error("invalid native batch selector");
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

/** Append evidence as it arrives; absence of a completion record means incomplete. */
export { createNativeRunJournal } from "./native-run-journal.ts";
