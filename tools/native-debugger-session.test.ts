import assert from "node:assert/strict";
import test from "node:test";
import { debugserverLaunchCommand } from "./native-debugger-session.ts";
test("debugserver terminates option parsing before forwarding inferior flags", () => {
  const command = debugserverLaunchCommand(
    '/tmp/a binary"\\name',
    "/tmp/private session",
    ["--debug-symbols", "-c", "a; $value"],
    30000,
    "direct",
  );
  const script = JSON.parse(command.slice("script exec(".length, -1));
  const match = script.match(
    /subprocess\.Popen\(\[debugserver_path\] \+ (\[[^\n]*\]), stdin=/,
  );
  assert.ok(match);
  const args = JSON.parse(match[1]);
  const separator = args.indexOf("--");
  assert.ok(
    separator >= 0,
    "inferior flags must not be parsed as debugserver options",
  );
  assert.deepEqual(args.slice(separator + 1), [
    "127.0.0.1:0",
    '/tmp/a binary"\\name',
    "--debug-symbols",
    "-c",
    "a; $value",
  ]);
});

test("debugger startup uses the caller's complete execution budget", () => {
  const command = debugserverLaunchCommand(
    "/tmp/program",
    "/tmp/session",
    [],
    4321,
  );
  const script = JSON.parse(command.slice("script exec(".length, -1));
  assert.ok(script.includes("port_socket.settimeout(4.321)"));
  assert.ok(script.includes("port_connection.settimeout(4.321)"));
  assert.throws(
    () => debugserverLaunchCommand("/tmp/program", "/tmp/session", [], 0),
    /timeout/,
  );
});

test(
  "synchronous debugger launch can own an isolated POSIX process group",
  { skip: process.platform === "win32" },
  async () => {
    const { spawnSync } = await import("node:child_process");
    const options = {
      encoding: "utf8" as const,
      detached: true,
      timeout: 5000,
    };
    const child = spawnSync(
      "/bin/sh",
      ["-c", 'printf "%s " "$$"; ps -o pgid= -p "$$"'],
      options,
    );
    assert.equal(child.status, 0, child.stderr);
    const identifiers = child.stdout.trim().split(/\s+/).map(Number);
    assert.deepEqual(identifiers, [child.pid, child.pid]);
  },
);

test("connected launch publishes the stub before requesting the inferior", () => {
  const command = debugserverLaunchCommand(
    '/tmp/a binary"\\name',
    "/tmp/session",
    ["--debug-symbols", "a; $value"],
    4321,
    "connected",
  );
  const script = JSON.parse(command.slice("script exec(".length, -1));
  const match = script.match(
    /subprocess\.Popen\(\[debugserver_path\] \+ (\[[^\n]*\]), stdin=/,
  );
  assert.ok(match);
  const args = JSON.parse(match[1]);
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["127.0.0.1:0"]);
  assert.ok(script.indexOf("gdb-remote") < script.indexOf("lldb.SBLaunchInfo"));
  assert.ok(script.includes("lldb.debugger.SetAsync(True)"));
  assert.ok(
    script.indexOf("lldb.debugger.SetAsync(True)") <
      script.indexOf("HandleCommand('gdb-remote"),
  );
  assert.ok(
    script.indexOf("lldb.debugger.SetAsync(False)") >
      script.indexOf("HandleCommand('gdb-remote"),
  );
  assert.ok(script.includes("lldb.eLaunchFlagStopAtEntry"));
  assert.ok(script.includes("lldb.eLaunchFlagDisableSTDIO"));
  assert.ok(script.includes("launch_error.Success()"));
});

test(
  "debugger scripts preserve Python syntax for quoted paths and arguments",
  { skip: process.platform !== "darwin" },
  async () => {
    const { execFileSync } = await import("node:child_process");
    for (const mode of ["direct", "connected"] as const) {
      const command = debugserverLaunchCommand(
        '/tmp/quoted "file"\\name',
        "/tmp/session",
        ["line\nnext", "--debug-symbols"],
        4321,
        mode,
      );
      const script = JSON.parse(command.slice("script exec(".length, -1));
      execFileSync(
        "python3",
        ["-c", "import ast,sys; ast.parse(sys.stdin.read())"],
        { input: script },
      );
    }
  },
);

test("default Darwin sessions connect before launching native code", () => {
  const command = debugserverLaunchCommand("/tmp/program", "/tmp/session", []);
  const script = JSON.parse(command.slice("script exec(".length, -1));
  assert.ok(script.includes("lldb.SBLaunchInfo"));
});

test("debugger diagnostics retain launch state and bounded protocol evidence", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const session = await import("./native-debugger-session.ts");
  assert.equal(typeof session.readDebuggerSessionLogs, "function");
  const directory = mkdtempSync(join(tmpdir(), "tint-debugger-log-test-"));
  try {
    writeFileSync(
      join(directory, "launch.log"),
      "launch succeeded; state=2; pid=0",
    );
    writeFileSync(
      join(directory, "state.log"),
      "discarded-prefix" + "x".repeat(4096) + "state-tail",
    );
    writeFileSync(join(directory, "packets.log"), "launch-packet-tail");
    const detail = session.readDebuggerSessionLogs(directory);
    assert.ok(detail.includes("launch succeeded; state=2; pid=0"));
    assert.ok(detail.includes("state-tail"));
    assert.ok(detail.includes("launch-packet-tail"));
    assert.ok(!detail.includes("discarded-prefix"));
    assert.ok(detail.length < 6500);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("optional process tracing quotes private paths and captures remote startup packets", async () => {
  const session = await import("./native-debugger-session.ts");
  assert.equal(typeof session.debuggerTraceCommands, "function");
  assert.deepEqual(session.debuggerTraceCommands('/tmp/private "session"'), [
    'log enable -f "/tmp/private \\"session\\"/packets.log" gdb-remote packets process',
    'log enable -f "/tmp/private \\"session\\"/state.log" lldb process state',
  ]);
});

test("Darwin debugger socket paths are checked in UTF-8 bytes before launch", () => {
  assert.doesNotThrow(() =>
    debugserverLaunchCommand("/tmp/program", "/tmp/" + "x".repeat(93), []),
  );
  for (const directory of ["/tmp/" + "x".repeat(94), "/tmp/" + "é".repeat(47)])
    assert.throws(
      () => debugserverLaunchCommand("/tmp/program", directory, []),
      /socket path.*103 UTF-8 bytes/,
    );
});
