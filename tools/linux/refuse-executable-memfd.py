#!/usr/bin/env python3
"""Runs a command as a kernel with vm.memfd_noexec=2 would (Linux 6.3+):
memfd_create fails with EACCES unless MFD_NOEXEC_SEAL is requested. A
seccomp filter answers the call, so older kernels (the 6.1 development VM)
exercise the executable-memory fallback (docs/native-code-loading.md,
"Linux"). The filter is inherited by every descendant, including a
debugger's inferior; it adds no privileges (PR_SET_NO_NEW_PRIVS).

usage: tools/linux/refuse-executable-memfd.py <command> [argument...]
"""
import ctypes
import os
import struct
import sys

AUDIT_ARCH_AARCH64 = 0xC00000B7
MEMFD_CREATE = 279  # asm-generic/unistd.h (arm64)
MFD_NOEXEC_SEAL = 0x8
EACCES = 13
PR_SET_NO_NEW_PRIVS = 38
PR_SET_SECCOMP = 22
SECCOMP_MODE_FILTER = 2
SECCOMP_RET_ALLOW = 0x7FFF0000
SECCOMP_RET_ERRNO = 0x00050000
SECCOMP_RET_KILL_PROCESS = 0x80000000
# struct seccomp_data: int nr; __u32 arch; __u64 ip; __u64 args[6].
NR, ARCH, FLAGS_LOW = 0, 4, 24
LD_W_ABS, JEQ_K, JSET_K, RET_K = 0x20, 0x15, 0x45, 0x06


def instruction(code, jt, jf, k):
    return struct.pack("HBBI", code, jt, jf, k)


program = [
    instruction(LD_W_ABS, 0, 0, ARCH),
    instruction(JEQ_K, 1, 0, AUDIT_ARCH_AARCH64),
    instruction(RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS),
    instruction(LD_W_ABS, 0, 0, NR),
    instruction(JEQ_K, 0, 3, MEMFD_CREATE),
    instruction(LD_W_ABS, 0, 0, FLAGS_LOW),
    instruction(JSET_K, 1, 0, MFD_NOEXEC_SEAL),
    instruction(RET_K, 0, 0, SECCOMP_RET_ERRNO | EACCES),
    instruction(RET_K, 0, 0, SECCOMP_RET_ALLOW),
]


class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_char_p)]


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_void_p,
                           ctypes.c_ulong, ctypes.c_ulong]
    code = b"".join(program)
    fprog = SockFprog(len(program), code)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, None, 0, 0) != 0:
        sys.exit("PR_SET_NO_NEW_PRIVS: " + os.strerror(ctypes.get_errno()))
    if libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER,
                  ctypes.cast(ctypes.pointer(fprog), ctypes.c_void_p), 0, 0) != 0:
        sys.exit("PR_SET_SECCOMP: " + os.strerror(ctypes.get_errno()))
    os.execvp(sys.argv[1], sys.argv[1:])


main()
