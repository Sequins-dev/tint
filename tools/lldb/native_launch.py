"""Launch a native image under LLDB, stopped at its entry point.

    lldb --no-lldbinit --batch \\
      -o 'command script import tools/lldb/native_launch.py' \\
      -o 'tint_start [--stdin PATH] [--stdout PATH] [--stderr PATH]' \\
      -o continue ... -- <image> [arguments]

`tint_start` replaces `process launch --stop-at-entry` followed by an
assertion of the stopped state (tools/lldb-launch.ts builds the arguments).
It launches the selected target with its usual launch settings (run
arguments, environment, `target.disable-aslr`, standard I/O) and the
stop-at-entry flag, fails unless the process is then stopped, and leaves it
stopped for the following commands. In batch mode the `process launch`
command spends about two seconds more per launch than this SB API launch
with the same flag, which dominated short native fixture runs.
"""

import argparse
import shlex

import lldb


def start(debugger, command, result, internal_dict):
    parser = argparse.ArgumentParser(prog="tint_start", add_help=False)
    parser.add_argument("--stdin")
    parser.add_argument("--stdout")
    parser.add_argument("--stderr")
    try:
        options = parser.parse_args(shlex.split(command))
    except SystemExit:
        result.SetError("usage: tint_start [--stdin PATH] [--stdout PATH] [--stderr PATH]")
        return
    debugger.SetAsync(False)
    target = debugger.GetSelectedTarget()
    if not target.IsValid():
        result.SetError("tint_start: no target")
        return
    info = target.GetLaunchInfo()
    info.SetLaunchFlags(info.GetLaunchFlags() | lldb.eLaunchFlagStopAtEntry)
    for fd, path, read, write in (
        (0, options.stdin, True, False),
        (1, options.stdout, False, True),
        (2, options.stderr, False, True),
    ):
        if path is not None:
            info.AddOpenFileAction(fd, path, read, write)
    error = lldb.SBError()
    process = target.Launch(info, error)
    if not error.Success() or not process.IsValid():
        result.SetError("tint_start: launch failed: " + (error.GetCString() or "no process"))
        return
    state = process.GetState()
    if state != lldb.eStateStopped:
        process.Kill()
        result.SetError(
            "tint_start: the launched process is not stopped at entry: "
            + lldb.SBDebugger.StateAsCString(state)
        )
        return
    result.AppendMessage("tint_start: process %d stopped at entry" % process.GetProcessID())


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f native_launch.start tint_start")
