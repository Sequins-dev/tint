"""Count a Tint image's USDT probes under GDB (docs/runtime-diagnostics.md).

    gdb -q -batch -nx -x tools/gdb/tint-probes.py <image>

GDB reads the image's `.note.stapsdt` probes itself (`info probes stap`), so
this needs no kernel tracing support (uprobes) and works in containers and
VMs without it. Every `tint` probe gets a breakpoint that counts its hits
per thread and continues; `gc__end` records its metrics (major, nursery,
copied and old bytes, interval identifier). The program then runs to
completion and a JSON summary is written to $TINT_PROBES_OUT (or printed):

    {"exitCode": 42, "probes": {"gc_collect__begin": {"count": 91,
     "threads": 1}, ...}, "collections": [[major, nursery, copied, old], ...]}
"""

import json
import os

import gdb

PROVIDER = "tint"
counts = {}
threads = {}
collections = []


class ProbeBreakpoint(gdb.Breakpoint):
    def __init__(self, name):
        super().__init__("-probe-stap %s:%s" % (PROVIDER, name), internal=True)
        self.probe = name

    def stop(self):
        counts[self.probe] = counts.get(self.probe, 0) + 1
        thread = gdb.selected_thread()
        threads.setdefault(self.probe, set()).add(
            thread.ptid[1] if thread is not None else 0
        )
        if self.probe == "gc__end":
            collections.append(
                [int(gdb.parse_and_eval("$_probe_arg%d" % i)) for i in range(4)]
            )
        return False


def probe_names():
    names = []
    listing = gdb.execute("info probes stap %s" % PROVIDER, to_string=True)
    for line in listing.splitlines():
        parts = line.split()
        # Type Provider Name Where [Semaphore] Object
        if len(parts) >= 3 and parts[0] == "stap" and parts[1] == PROVIDER:
            if parts[2] not in names:
                names.append(parts[2])
    return names


def main():
    gdb.execute("set pagination off")
    gdb.execute("set confirm off")
    names = probe_names()
    if not names:
        raise gdb.GdbError("the image has no %s probes" % PROVIDER)
    for name in names:
        ProbeBreakpoint(name)
    gdb.execute("run")
    code = gdb.parse_and_eval("$_exitcode")
    summary = {
        "exitCode": None if code.type.code == gdb.TYPE_CODE_VOID else int(code),
        "listed": names,
        "probes": {
            name: {"count": counts[name], "threads": len(threads[name])}
            for name in sorted(counts)
        },
        "collections": collections,
    }
    text = json.dumps(summary)
    out = os.environ.get("TINT_PROBES_OUT")
    if out:
        with open(out, "w") as handle:
            handle.write(text + "\n")
    else:
        print(text)


main()
