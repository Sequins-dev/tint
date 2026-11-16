"""Runtime-neutral LLDB helpers for the native DevTools bridge
(docs/native-devtools.md) and the profiling CLI (tools/heap-snapshot/cli.ts).

    (lldb) command script import <tint checkout>/tools/lldb/devtools.py

adds the `devtools` command, whose subcommands print one JSON line each:

    devtools sources               source files of every module's line tables
    devtools symbolize <addr>...   load addresses -> lines, innermost inlined
                                   callee first, with function start lines
    devtools stack [--thread N]    the stopped thread's frames as locations

Nothing here knows a language runtime: it reads DWARF line tables and
inlined-subroutine blocks only, so it serves any program built with
debug info (clang -g, Tint debug builds, ...).
"""

import json
import os
import shlex

import lldb


def _file_path(spec):
    if spec is None or not spec.IsValid():
        return None
    directory = spec.GetDirectory()
    name = spec.GetFilename()
    if not name:
        return None
    return os.path.join(directory, name) if directory else name


def symbolize(target, address):
    """The source lines at an SBAddress, innermost inlined callee first;
    the physical function's entry carries its start line."""
    context = address.GetSymbolContext(lldb.eSymbolContextEverything)
    entry = context.GetLineEntry()
    file = _file_path(entry.GetFileSpec()) if entry.IsValid() else None
    line = entry.GetLine() if entry.IsValid() else 0
    column = entry.GetColumn() if entry.IsValid() else 0
    lines = []
    block = context.GetBlock()
    inlined = block.GetContainingInlinedBlock() if block.IsValid() else lldb.SBBlock()
    while inlined.IsValid():
        lines.append({"function": inlined.GetInlinedName() or "?", "file": file, "line": line, "column": column})
        file = _file_path(inlined.GetInlinedCallSiteFile())
        line = inlined.GetInlinedCallSiteLine()
        column = inlined.GetInlinedCallSiteColumn()
        parent = inlined.GetParent()
        inlined = parent.GetContainingInlinedBlock() if parent.IsValid() else lldb.SBBlock()
    function = context.GetFunction()
    symbol = context.GetSymbol()
    if function.IsValid():
        name = function.GetDisplayName() or function.GetName()
        start = function.GetStartAddress().GetLineEntry()
        start_line = start.GetLine() if start.IsValid() else 0
    elif symbol.IsValid():
        name = symbol.GetDisplayName() or symbol.GetName()
        start_line = 0
    else:
        name = "0x%x" % address.GetLoadAddress(target)
        start_line = 0
    entry = {"function": name or "?", "file": file, "line": line, "column": column}
    if start_line:
        entry["startLine"] = start_line
    lines.append(entry)
    return lines


def sources(target):
    """Every file the modules' line tables name, with its module."""
    seen = {}
    for module in target.module_iter():
        module_path = _file_path(module.GetFileSpec())
        for unit in module.compile_unit_iter():
            for index in range(unit.GetNumSupportFiles()):
                path = _file_path(unit.GetSupportFileAtIndex(index))
                if path and path not in seen:
                    seen[path] = module_path
            path = _file_path(unit.GetFileSpec())
            if path and path not in seen:
                seen[path] = module_path
    return [{"path": path, "module": module} for path, module in seen.items()]


def stack(thread, target):
    """Physical frames of a thread, each with its inlined lines."""
    frames = []
    current = None
    for index in range(thread.GetNumFrames()):
        frame = thread.GetFrameAtIndex(index)
        pc = frame.GetPC()
        if current is not None and current["pc"] == pc and current["cfa"] == frame.GetCFA():
            continue
        current = {"pc": pc, "cfa": frame.GetCFA()}
        frames.append({"address": pc, "lines": symbolize(target, frame.GetPCAddress())})
    return frames


def devtools_command(debugger, command, result, internal_dict):
    args = shlex.split(command)
    target = debugger.GetSelectedTarget()
    try:
        if not args or args[0] in ("help", "-h", "--help"):
            result.AppendMessage(__doc__)
        elif args[0] == "sources":
            result.AppendMessage("DEVTOOLS " + json.dumps(sources(target)))
        elif args[0] == "symbolize":
            out = {}
            for text in args[1:]:
                address = int(text, 0)
                resolved = target.ResolveLoadAddress(address)
                if not resolved.IsValid() or not resolved.GetModule().IsValid():
                    resolved = target.ResolveFileAddress(address)
                out[str(address)] = symbolize(target, resolved)
            result.AppendMessage("DEVTOOLS " + json.dumps(out))
        elif args[0] == "stack":
            process = target.GetProcess()
            thread = process.GetSelectedThread()
            if "--thread" in args:
                thread = process.GetThreadByID(int(args[args.index("--thread") + 1]))
            result.AppendMessage("DEVTOOLS " + json.dumps(stack(thread, target)))
        else:
            result.SetError("unknown devtools command %s" % args[0])
    except Exception as error:  # reported to the bridge as a failed command
        result.SetError("%s: %s" % (type(error).__name__, error))


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -o -f %s.devtools_command devtools" % __name__)
