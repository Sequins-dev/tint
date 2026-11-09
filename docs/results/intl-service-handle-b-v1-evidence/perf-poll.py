#!/usr/bin/env python3
"""Find the process whose executable is <image>, poll its proc_pid_rusage CPU
every 2 ms until it exits, and print the last user+system seconds and sample
count. Used alongside an LLDB-launched case; excludes debugger overhead."""
import ctypes, os, sys, time

libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
libc = ctypes.CDLL("/usr/lib/libSystem.dylib")


class RusageInfoV2(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16), ("user", ctypes.c_uint64), ("system", ctypes.c_uint64)] + [
        ("f%d" % i, ctypes.c_uint64) for i in range(40)
    ]


class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]


tb = Timebase()
libc.mach_timebase_info(ctypes.byref(tb))
tick = tb.numer / tb.denom
image = os.path.realpath(sys.argv[1])
timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0
buf = ctypes.create_string_buffer(4096)
pids = (ctypes.c_int * 8192)()


def find():
    n = libproc.proc_listallpids(pids, ctypes.sizeof(pids))
    for i in range(n):
        pid = pids[i]
        if pid > 0 and libproc.proc_pidpath(pid, buf, 4096) > 0 and buf.value.decode(errors="replace") == image:
            return pid
    return None


deadline = time.time() + timeout
pid = None
while pid is None and time.time() < deadline:
    pid = find()
    if pid is None:
        time.sleep(0.002)
if pid is None:
    print("nopid 0 0 0 0")
    sys.exit(0)
last, samples, info = 0.0, 0, RusageInfoV2()
instructions = cycles = 0
while time.time() < deadline:
    if libproc.proc_pid_rusage(pid, 4, ctypes.byref(info)) != 0:
        break
    last, samples = (info.user + info.system) * tick / 1e9, samples + 1
    instructions, cycles = info.f27, info.f28
    time.sleep(0.002)
print("%d %.4f %d %d %d" % (pid, last, samples, instructions, cycles))
