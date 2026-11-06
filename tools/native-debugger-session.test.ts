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
  assert.ok(script.indexOf("gdb-remote") < script.indexOf(".RemoteLaunch("));
  assert.ok(
    script.indexOf("StopListeningForEvents") < script.indexOf(".RemoteLaunch("),
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

test(
  "connected sessions launch through the existing process rather than replacing it",
  { skip: process.platform !== "darwin" },
  async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { spawnSync } = await import("node:child_process");
    const directory = mkdtempSync("/tmp/tint-dbg-");
    const args = ["a b", "line\nnext", "--debug-symbols"];
    const command = debugserverLaunchCommand("/tmp/program", directory, args);
    const script = JSON.parse(command.slice("script exec(".length, -1));
    const model = `
import sys, types, json
class Error:
    message = None
    def Success(self): return self.message is None
    def GetCString(self): return self.message
state = {'value': 2, 'pid': 0, 'calls': 0}
def remote_launch(argv, envp, stdin, stdout, stderr, cwd, flags, stop, error):
    assert state['value'] == 2
    assert argv == ${JSON.stringify(args)}
    assert flags & 4 and stop
    state.update(value=5, pid=1234, calls=state['calls']+1)
    return True
process = types.SimpleNamespace(GetState=lambda:state['value'], GetProcessID=lambda:state['pid'], GetBroadcaster=lambda:process, RemoteLaunch=remote_launch)
def replace_process(info, error):
    error.message = 'a process is already being debugged'
    return types.SimpleNamespace(GetState=lambda:0)
target = types.SimpleNamespace(GetProcess=lambda:process, Launch=replace_process)
result = lambda:types.SimpleNamespace(GetOutput=lambda:'', GetError=lambda:'', Succeeded=lambda:True)
interpreter = types.SimpleNamespace(HandleCommand=lambda command,result:None)
debugger = types.SimpleNamespace(SetAsync=lambda flag:None, GetCommandInterpreter=lambda:interpreter, GetSelectedTarget=lambda:target)
info = lambda args:types.SimpleNamespace(SetExecutableFile=lambda *args:None, SetLaunchFlags=lambda flags:None)
support = types.SimpleNamespace(GetDirectory=lambda:'/toolchain', GetFilename=lambda:'bin')
listener = lambda *args:types.SimpleNamespace(StartListeningForEvents=lambda broadcaster,mask:mask, StopListeningForEvents=lambda *args:True, WaitForEvent=lambda *args:False)
lldb = types.SimpleNamespace(SBListener=listener, SBEvent=lambda:object(), SBProcess=types.SimpleNamespace(eBroadcastBitStateChanged=1), debugger=debugger, SBHostOS=types.SimpleNamespace(GetLLDBPath=lambda kind:support), ePathTypeSupportExecutableDir=0, SBCommandReturnObject=result, SBLaunchInfo=info, SBFileSpec=lambda path:path, SBError=Error, eStateConnected=2, eStateStopped=5, eLaunchFlagDebug=1, eLaunchFlagStopAtEntry=2, eLaunchFlagDisableSTDIO=4)
chunks = iter([b'12345', b''])
connection = types.SimpleNamespace(settimeout=lambda timeout:None, recv=lambda size:next(chunks), close=lambda:None)
model_socket = types.SimpleNamespace(settimeout=lambda timeout:None, bind=lambda path:None, listen=lambda count:None, accept=lambda:(connection,None), close=lambda:None)
sys.modules['socket'] = types.SimpleNamespace(AF_UNIX=1, SOCK_STREAM=1, socket=lambda *args:model_socket)
sys.modules['subprocess'] = types.SimpleNamespace(Popen=lambda *args,**kwargs:types.SimpleNamespace(pid=123), DEVNULL=-3, STDOUT=-2)
`;
    try {
      const result = spawnSync(
        "python3",
        [
          "-c",
          model +
            "\n" +
            script +
            "\nassert state == {'value':5,'pid':1234,'calls':1}\n",
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "connected launch waits for process readiness before launching exactly once",
  { skip: process.platform !== "darwin" },
  async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = mkdtempSync(join(tmpdir(), "tint-connect-"));
    const script = JSON.parse(
      debugserverLaunchCommand(
        "/tmp/program",
        directory,
        [],
        50,
        "connected",
      ).slice("script exec(".length, -1),
    );
    // Model the LLDB contract: connection can return before its
    // process state is published. Launch is legal only after eStateConnected.
    const driver = `
import sys, types
class Sock:
 def __init__(self): self.reads=0
 def settimeout(self, seconds): pass
 def bind(self, path): pass
 def listen(self, count): pass
 def accept(self): return Sock(), None
 def recv(self, count):
  self.reads+=1
  return b'1234' if self.reads==1 else b''
 def close(self): pass
sys.modules['socket']=types.SimpleNamespace(AF_UNIX=1,SOCK_STREAM=1,socket=lambda *args:Sock())
sys.modules['subprocess']=types.SimpleNamespace(DEVNULL=-1,STDOUT=-2,Popen=lambda *args,**kwargs:types.SimpleNamespace(pid=123))
class Result:
 def Succeeded(self): return True
 def GetOutput(self): return ''
 def GetError(self): return ''
class Process:
 def __init__(self): self.state=4
 def GetState(self): return self.state
 def GetBroadcaster(self): return self
 def GetProcessID(self): return 1234 if self.state==5 else 0
 def RemoteLaunch(self,argv,envp,stdin,stdout,stderr,cwd,flags,stop,error):
  assert self.GetState()==2
  target.launches+=1
  self.state=5
  return True
class Listener:
 def __init__(self): self.events=0
 def StartListeningForEvents(self,broadcaster,mask):
  self.broadcaster=broadcaster
  return mask
 def StopListeningForEvents(self,broadcaster,mask): return True
 def WaitForEvent(self,seconds,event):
  broadcaster=self.broadcaster
  self.events+=1
  broadcaster.state=2
  return True
class Error:
 def Success(self): return True
 def GetCString(self): return ''
class Info:
 def __init__(self,*args): pass
 def SetExecutableFile(self,*args): pass
 def SetLaunchFlags(self,*args): pass
class Target:
 def __init__(self): self.process=Process(); self.launches=0
 def GetProcess(self): return self.process
 def Launch(self,info,error):
  raise AssertionError('must launch through the existing process')
target=Target()
listener=Listener()
debugger=types.SimpleNamespace(GetListener=lambda:listener,SetAsync=lambda value:None,GetSelectedTarget=lambda:target,GetCommandInterpreter=lambda:types.SimpleNamespace(HandleCommand=lambda *args:None))
lldb=types.SimpleNamespace(SBListener=lambda *args:listener,eStateCrashed=8,eStateDetached=9,eStateExited=10,debugger=debugger,SBEvent=lambda:object(),SBProcess=types.SimpleNamespace(eBroadcastBitStateChanged=1),SBCommandReturnObject=Result,SBLaunchInfo=Info,SBError=Error,SBFileSpec=lambda path:path,eStateInvalid=0,eStateUnloaded=1,eStateConnected=2,eStateAttaching=3,eStateLaunching=4,eLaunchFlagDebug=1,eLaunchFlagStopAtEntry=2,eLaunchFlagDisableSTDIO=4,ePathTypeSupportExecutableDir=1,SBHostOS=types.SimpleNamespace(GetLLDBPath=lambda value:types.SimpleNamespace(GetDirectory=lambda:'/tmp',GetFilename=lambda:'support')))
exec(${JSON.stringify(script)})
assert target.launches==1 and listener.events==1
`;
    try {
      execFileSync("python3", ["-c", driver], {
        timeout: 10000,
        stdio: "pipe",
      });
      for (const [before, replacement, expected] of [
        [
          "self.state=4",
          "self.state=8",
          /unexpected process before remote launch: 8/,
        ],
        [
          "broadcaster.state=2",
          "broadcaster.state=4",
          /debugserver did not reach connected state/,
        ],
      ] as const)
        assert.throws(
          () =>
            execFileSync(
              "python3",
              ["-c", driver.replace(before, replacement)],
              { timeout: 10000, stdio: "pipe" },
            ),
          expected,
        );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
