/** Thread identity and fatal exit for runtime-registered Node FFI callbacks. */
declare module "tint:c/ffi-callbacks" {
  import type { Address } from "tint:ffi";
  export function pthread_self(): Address<void>;
  export function abort(): void;
}
