// Darwin sys/event.h and sys/fcntl.h. Buffers are the system's kevent64_s
// and timespec layouts, owned by the caller. Address<void> slots pass NULL.
declare module "tint:c/darwin-reactor" {
  import type { Address, i32, OrErrno, Ptr, u32, Variadic } from "tint:ffi";
  export function kqueue(): OrErrno<i32>;
  export function fcntl$setDescriptor(
    fd: i32,
    command: i32,
    flags: Variadic<i32>,
  ): OrErrno<i32>;
  export function kevent64$change(
    fd: i32,
    changes: Ptr<void>,
    changeCount: i32,
    events: Address<void>,
    eventCount: i32,
    flags: u32,
    timeout: Address<void>,
  ): OrErrno<i32>;
  export function kevent64$poll(
    fd: i32,
    changes: Address<void>,
    changeCount: i32,
    events: Ptr<void>,
    eventCount: i32,
    flags: u32,
    timeout: Ptr<void>,
  ): OrErrno<i32>;
  export function kevent64$wait(
    fd: i32,
    changes: Address<void>,
    changeCount: i32,
    events: Ptr<void>,
    eventCount: i32,
    flags: u32,
    timeout: Address<void>,
  ): OrErrno<i32>;
  export function getpid(): i32;
  /** libproc.h: PROC_PIDTASKINFO (flavor 4) writes struct proc_taskinfo (96 bytes). */
  export function proc_pidinfo(
    pid: i32,
    flavor: i32,
    arg: Address<void>,
    buffer: Ptr<void>,
    buffersize: i32,
  ): i32;
}
