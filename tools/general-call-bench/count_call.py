"""LLDB command: count the instructions one warm call of a function executes.

    lldb --no-lldbinit --batch \
      -o "settings set target.disable-aslr false" \
      -o "process launch --stop-at-entry" \
      -o "command script import tools/general-call-bench/count_call.py" \
      -o "count_call <file-address> <calls-to-skip> <out.json>" \
      -o "process kill" <binary>

The file address is the function's unslid start (tools/disasm/annotate.ts
prints it). The command continues to the call after `calls-to-skip` hits,
single-steps every instruction (callees included) until the function returns
to its caller, and writes the executed PCs, the total and a per-symbol count.
Attribute the PCs to IR operations with the image's operations.json
(TINT_OPERATION_RANGES=1).
"""
import json

import lldb


def count_call(debugger, command, result, internal_dict):
    arguments = command.split()
    skip = int(arguments[1])
    output = arguments[2]
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    address = target.ResolveFileAddress(int(arguments[0], 16)).GetLoadAddress(
        target
    )
    breakpoint = target.BreakpointCreateByAddress(address)
    hits = 0
    while True:
        process.Continue()
        if process.GetState() != lldb.eStateStopped:
            print("TRACE process ended before the warm call", process.GetState())
            return
        thread = process.GetSelectedThread()
        if (
            thread.GetStopReason() == lldb.eStopReasonBreakpoint
            and thread.GetFrameAtIndex(0).GetPC() == address
        ):
            hits += 1
            if hits > skip:
                break
    target.BreakpointDelete(breakpoint.GetID())
    thread = process.GetSelectedThread()
    frame = thread.GetFrameAtIndex(0)
    entry_sp = frame.GetSP()
    return_address = frame.FindRegister("lr").GetValueAsUnsigned()
    pcs = []
    while True:
        frame = thread.GetFrameAtIndex(0)
        if frame.GetPC() == return_address and frame.GetSP() >= entry_sp:
            break
        pcs.append(frame.GetPC())
        thread.StepInstruction(False)
        if len(pcs) > 1000000:
            print("TRACE stopped after 1000000 instructions")
            break
    symbols = {}
    for pc in pcs:
        name = target.ResolveLoadAddress(pc).GetSymbol().GetName() or "?"
        symbols[name] = symbols.get(name, 0) + 1
    with open(output, "w") as file:
        json.dump(
            {
                "fileAddress": arguments[0],
                "loadAddress": hex(address),
                "skip": skip,
                "instructions": len(pcs),
                "bySymbol": symbols,
                "pcs": [hex(pc) for pc in pcs],
            },
            file,
        )
    print("TRACE instructions", len(pcs))


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f count_call.count_call count_call")
