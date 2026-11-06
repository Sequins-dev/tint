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
    "import os, socket, subprocess",
    ...(mode === "connected"
      ? [
          "import time",
          `connection_deadline = time.monotonic() + ${startupTimeoutMs / 1000}`,
        ]
      : []),
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
    ...(mode === "connected" ? ["lldb.debugger.SetAsync(True)"] : []),
    "lldb.debugger.GetCommandInterpreter().HandleCommand('gdb-remote 127.0.0.1:' + str(port), connection_result)",
    `open(${JSON.stringify(join(directory, "connection.log"))}, 'w').write((connection_result.GetOutput() or '') + (connection_result.GetError() or ''))`,
    "assert connection_result.Succeeded(), connection_result.GetError()",
  ];
  if (mode === "connected")
    script.push(
      "lldb.debugger.SetAsync(False)",
      "launch_process = lldb.debugger.GetSelectedTarget().GetProcess()",
      // A connected stub can briefly publish stopped/PID 0 before the private
      // state thread normalizes its public state. Await that event, not a retry
      // of RemoteLaunch. Unsubscribe before the real inferior's initial stop.
      "connection_listener = lldb.SBListener('tint-connected-startup')",
      "connection_broadcaster = launch_process.GetBroadcaster()",
      "connection_mask = lldb.SBProcess.eBroadcastBitStateChanged",
      "assert connection_listener.StartListeningForEvents(connection_broadcaster, connection_mask) & connection_mask",
      "try:",
      "    while True:",
      "        if time.monotonic() >= connection_deadline: raise TimeoutError('debugserver did not reach connected state')",
      "        connection_state = launch_process.GetState()",
      "        if connection_state == lldb.eStateConnected: break",
      `        open(${JSON.stringify(join(directory, "connection-wait.log"))}, 'a').write(str(connection_state) + ' pid=' + str(launch_process.GetProcessID()) + chr(10))`,
      "        if launch_process.GetProcessID() > 0 or connection_state in [lldb.eStateExited, lldb.eStateDetached, lldb.eStateCrashed]: raise RuntimeError('unexpected process before remote launch: ' + str(connection_state))",
      "        connection_listener.WaitForEvent(1, lldb.SBEvent())",
      "finally:",
      "    connection_listener.StopListeningForEvents(connection_broadcaster, connection_mask)",
      "assert launch_process.GetState() == lldb.eStateConnected, 'debugserver is not connected'",
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
    ["Connection wait", "connection-wait.log"],
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
