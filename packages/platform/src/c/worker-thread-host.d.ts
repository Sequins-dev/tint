declare module "tint:c/worker-thread-host" {
  import type { Address, i32, OrErrno, Ptr, Variadic } from "tint:ffi";
  export function pipe(descriptors: Ptr<i32>): OrErrno<i32>;
  export function dup(fd: i32): OrErrno<i32>;
  export function pthread_detach(thread: Address<void>): i32;
  export function fcntl$setFlags(
    fd: i32,
    command: i32,
    flags: Variadic<i32>,
  ): OrErrno<i32>;
}
