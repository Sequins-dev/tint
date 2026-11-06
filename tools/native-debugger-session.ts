import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Let Darwin's bundled stub own launch and the initial stop, avoiding local vAttach. */
export function debugserverLaunchCommand(
  binary: string,
  directory: string,
  arguments_: readonly string[],
  startupTimeoutMs: number = 30000,
  mode: "direct" | "connected" = "connected",
): string {
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0)
    throw new Error("invalid debugger startup timeout");
  const socketPath = join(directory, "port");
  // Darwin sockaddr_un reserves 104 bytes including its terminating NUL.
  if (new TextEncoder().encode(socketPath).length > 103)
    throw Error(
      "debugger socket path exceeds 103 UTF-8 bytes; use a shorter session directory",
    );
  const args = [
    "--kill-on-error",
    "--no-stdio",
    "--unix-socket",
    socketPath,
    "--",
    "127.0.0.1:0",
    ...(mode === "direct" ? [binary, ...arguments_] : []),
  ];
  const script = [
    "import os, socket, subprocess, time",
    "support = lldb.SBHostOS.GetLLDBPath(lldb.ePathTypeSupportExecutableDir)",
    "debugserver_path = os.path.join(support.GetDirectory() or '', support.GetFilename() or '', 'debugserver')",
    "port_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
    `port_socket.settimeout(${startupTimeoutMs / 1000})`,
    `port_socket.bind(${JSON.stringify(socketPath)})`,
    "port_socket.listen(1)",
    `debugserver_output = open(${JSON.stringify(join(directory, "debugserver.log"))}, 'wb')`,
    `debugserver = subprocess.Popen([debugserver_path] + ${JSON.stringify(args)}, stdin=subprocess.DEVNULL, stdout=debugserver_output, stderr=subprocess.STDOUT)`,
    `open(${JSON.stringify(join(directory, "debugserver-pid"))}, 'w').write(str(debugserver.pid))`,
    "port_connection, _ = port_socket.accept()",
    `port_connection.settimeout(${startupTimeoutMs / 1000})`,
    "port_parts = []",
    "while True:",
    "    part = port_connection.recv(64)",
    "    if not part: break",
    "    port_parts.append(part)",
    "port_connection.close()",
    "port_socket.close()",
    "port = int(b''.join(port_parts).decode('ascii'))",
    "assert 0 < port <= 65535",
    "connection_result = lldb.SBCommandReturnObject()",
    ...(mode === "connected"
      ? [
          "lldb.debugger.SetAsync(True)",
          "connection_started = time.monotonic()",
        ]
      : []),
    "lldb.debugger.GetCommandInterpreter().HandleCommand('gdb-remote 127.0.0.1:' + str(port), connection_result)",
    `open(${JSON.stringify(join(directory, "connection.log"))}, 'w').write((connection_result.GetOutput() or '') + (connection_result.GetError() or ''))`,
    "assert connection_result.Succeeded(), connection_result.GetError()",
  ];
  if (mode === "connected")
    script.push(
      // Async connection may return before the primary listener publishes its
      // state event. Consume only this process's state events before launching.
      `connection_deadline = connection_started + ${startupTimeoutMs / 1000}`,
      "while True:",
      "    launch_process = lldb.debugger.GetSelectedTarget().GetProcess()",
      "    connection_state = launch_process.GetState()",
      "    if connection_state == lldb.eStateConnected: break",
      "    assert connection_state in (lldb.eStateInvalid, lldb.eStateUnloaded, lldb.eStateAttaching, lldb.eStateLaunching), 'unexpected remote connection state: ' + str(connection_state)",
      "    assert time.monotonic() < connection_deadline, 'remote connection did not reach eStateConnected'",
      "    connection_event = lldb.SBEvent()",
      "    if lldb.debugger.GetListener().GetNextEventForBroadcasterWithType(launch_process.GetBroadcaster(), lldb.SBProcess.eBroadcastBitStateChanged, connection_event): continue",
      "    time.sleep(0.01)",
      `open(${JSON.stringify(join(directory, "connection-ready.log"))}, 'w').write('state=' + str(connection_state) + ' elapsed=' + str(time.monotonic() - connection_started))`,
      "lldb.debugger.SetAsync(False)",
      "launch_error = lldb.SBError()",
      // Launch through the connected process rather than asking SBTarget to
      // launch another process; retain the existing connection and listener.
      // https://lldb.llvm.org/python_reference/lldb.SBProcess-class.html#RemoteLaunch
      `launch_succeeded = launch_process.RemoteLaunch(${JSON.stringify(arguments_)}, None, None, None, None, None, lldb.eLaunchFlagDebug | lldb.eLaunchFlagStopAtEntry | lldb.eLaunchFlagDisableSTDIO, True, launch_error)`,
      `open(${JSON.stringify(join(directory, "launch.log"))}, 'w').write((launch_error.GetCString() or '') + chr(10) + 'state=' + str(launch_process.GetState()))`,
      "assert launch_succeeded and launch_error.Success(), launch_error.GetCString()",
    );
  return "script exec(" + JSON.stringify(script.join("\n")) + ")";
}

/** Diagnostic tracing is opt-in and does not resume or retry an inferior. */
export function debuggerTraceCommands(directory: string): readonly string[] {
  return [
    "log enable -f " +
      JSON.stringify(join(directory, "packets.log")) +
      " gdb-remote packets process",
    "log enable -f " +
      JSON.stringify(join(directory, "state.log")) +
      " lldb process state",
  ];
}

/** Preserve the final startup evidence even when no inferior was established. */
export function readDebuggerSessionLogs(directory: string): string {
  let detail = "";
  for (const [label, filename] of [
    ["Debugserver", "debugserver.log"],
    ["Connection", "connection.log"],
    ["Connection readiness", "connection-ready.log"],
    ["Launch", "launch.log"],
    ["Process state", "state.log"],
    ["Remote packets", "packets.log"],
  ] as const) {
    let contents = "";
    try {
      contents = readFileSync(join(directory, filename), "utf8");
    } catch {}
    detail += "\n" + label + ": " + contents.slice(-2048);
  }
  return detail;
}

function ownedPid(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, "utf8"));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}
function killOwnedPid(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
export function cleanupDebuggerSession(directory: string): void {
  killOwnedPid(ownedPid(join(directory, "pid")));
  const server = ownedPid(join(directory, "debugserver-pid"));
  if (server === undefined) return;
  // During a launch failure the stub may own a suspended inferior before LLDB
  // can write its PID. Limit discovery to children of this run's private stub.
  try {
    process.kill(server, 0);
    const children = spawnSync("pgrep", ["-P", String(server)], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 16384,
    });
    for (const line of children.stdout?.trim().split("\n") ?? []) {
      const pid = Number(line);
      if (Number.isSafeInteger(pid) && pid > 0) killOwnedPid(pid);
    }
  } catch {}
  killOwnedPid(server);
}
