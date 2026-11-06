import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugserverLaunchCommand } from "./native-debugger-session.ts";

// Exercise the generated Python against the actual observed PID-0 state sequence,
// without a nondeterministic OS launch in the unit suite. Native stress evidence
// exercises the same protocol with Darwin's real debugger separately.
const simulatedDebugger = String.raw`
import json,sys,types
request=json.load(sys.stdin)
mode=request['mode']
clock=[0.0]
log=[]
class Process:
    state=10 if mode=='terminal' else 2 if mode=='late' else 5
    pid=0
    launches=0
    def GetState(self): return self.state
    def GetProcessID(self): return self.pid
    def GetBroadcaster(self): return self
    def RemoteLaunch(self,*args):
        assert self.state==2
        self.launches+=1
        log.append('launch')
        self.state=5
        self.pid=123
        return True
process=Process()
class Listener:
    calls=0
    closed=False
    def __init__(self,*args): pass
    def StartListeningForEvents(self,broadcaster,mask):
        assert broadcaster is process
        log.append('listen')
        return mask
    def WaitForEvent(self,seconds,event):
        assert seconds==1
        self.calls+=1
        clock[0]+=seconds
        if mode=='connect' and self.calls==2: process.state=2
        return process.state==2
    def StopListeningForEvents(self,broadcaster,mask):
        self.closed=True
        log.append('unlisten')
        return True
listeners=[]
def listener(*args):
    value=Listener(*args)
    listeners.append(value)
    return value
class Result:
    def GetOutput(self): return ''
    def GetError(self): return ''
    def Succeeded(self): return True
class Error:
    def GetCString(self): return ''
    def Success(self): return True
class Debugger:
    def SetAsync(self,value): pass
    def GetCommandInterpreter(self): return self
    def HandleCommand(self,command,result):
        assert command.startswith('gdb-remote ')
        if mode=='late': clock[0]+=6
    def GetSelectedTarget(self): return self
    def GetProcess(self): return process
class Support:
    def GetDirectory(self): return '/tmp'
    def GetFilename(self): return 'support'
class Connection:
    count=0
    def settimeout(self,value): pass
    def recv(self,count):
        self.count+=1
        return b'12345' if self.count==1 else b''
    def close(self): pass
class Socket:
    def settimeout(self,value): pass
    def bind(self,value): pass
    def listen(self,value): pass
    def accept(self): return Connection(),None
    def close(self): pass
sys.modules['socket']=types.SimpleNamespace(AF_UNIX=1,SOCK_STREAM=1,socket=lambda *args:Socket())
sys.modules['subprocess']=types.SimpleNamespace(DEVNULL=-1,STDOUT=-2,Popen=lambda *args,**kwargs:types.SimpleNamespace(pid=999))
sys.modules['time']=types.SimpleNamespace(monotonic=lambda:clock[0])
lldb=types.SimpleNamespace(SBHostOS=types.SimpleNamespace(GetLLDBPath=lambda value:Support()),ePathTypeSupportExecutableDir=1,SBCommandReturnObject=Result,debugger=Debugger(),SBError=Error,SBListener=listener,SBEvent=lambda:object(),SBProcess=types.SimpleNamespace(eBroadcastBitStateChanged=1),eStateConnected=2,eStateStopped=5,eStateExited=10,eStateDetached=9,eStateCrashed=8,eLaunchFlagDebug=1,eLaunchFlagStopAtEntry=2,eLaunchFlagDisableSTDIO=4)
error=None
try: exec(request['script'],{'lldb':lldb})
except BaseException as caught: error=type(caught).__name__
print(json.dumps({'error':error,'launches':process.launches,'waits':sum(x.calls for x in listeners),'closed':all(x.closed for x in listeners),'clock':clock[0],'events':log}))
`;
function run(mode: "connect" | "never" | "terminal" | "late") {
  const directory = mkdtempSync(join(tmpdir(), "tint-connection-test-"));
  try {
    const command = debugserverLaunchCommand(
      "/tmp/program",
      directory,
      ["--debug-symbols"],
      4321,
      "connected",
    );
    const script = JSON.parse(command.slice("script exec(".length, -1));
    return JSON.parse(
      execFileSync("python3", ["-c", simulatedDebugger], {
        input: JSON.stringify({ script, mode }),
        encoding: "utf8",
        timeout: 10000,
      }),
    ) as {
      error: string | null;
      launches: number;
      waits: number;
      closed: boolean;
      clock: number;
      events: string[];
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const options = { skip: process.platform !== "darwin" };
test(
  "connected startup waits through PID-0 stopped events before one launch",
  options,
  () => {
    const result = run("connect");
    assert.equal(result.error, null);
    assert.equal(result.launches, 1);
    assert.equal(result.waits, 2);
    assert.equal(result.closed, true);
    assert.deepEqual(result.events, ["listen", "unlisten", "launch"]);
  },
);
test(
  "connection-state waiting exhausts the startup budget without launching",
  options,
  () => {
    const result = run("never");
    assert.equal(result.error, "TimeoutError");
    assert.equal(result.launches, 0);
    assert.equal(result.closed, true);
    assert.ok(result.clock >= 4.321 && result.clock < 5.321);
  },
);
test(
  "a terminal prelaunch process is rejected without a launch attempt",
  options,
  () => {
    const result = run("terminal");
    assert.equal(result.error, "RuntimeError");
    assert.equal(result.launches, 0);
    assert.equal(result.waits, 0);
    assert.equal(result.closed, true);
  },
);

test(
  "an already-connected stub cannot launch after its startup budget",
  options,
  () => {
    const result = run("late");
    assert.equal(result.error, "TimeoutError");
    assert.equal(result.launches, 0);
    assert.equal(result.closed, true);
  },
);
