// glibc sys/epoll.h and sys/eventfd.h, including the packed x86-64 event.
declare module "tint:c/linux-reactor" {
  import type { Address, i32, OrErrno, Ptr, u32 } from "tint:ffi";
  export function epoll_create1(flags: i32): OrErrno<i32>;
  export function eventfd(initial: u32, flags: i32): OrErrno<i32>;
  export function epoll_ctl(
    queue: i32,
    operation: i32,
    fd: i32,
    event: Ptr<void>,
  ): OrErrno<i32>;
  export function epoll_ctl$delete(
    queue: i32,
    operation: i32,
    fd: i32,
    event: Address<void>,
  ): OrErrno<i32>;
  export function epoll_wait(
    queue: i32,
    events: Ptr<void>,
    capacity: i32,
    timeout: i32,
  ): OrErrno<i32>;
}
