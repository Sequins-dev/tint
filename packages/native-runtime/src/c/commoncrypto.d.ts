declare module "tint:c/commoncrypto" {
  // CommonCrypto message digests (<CommonCrypto/CommonDigest.h>), resolved
  // through libSystem's re-exports (docs/native-ffi.md).
  import type { i32, u8, u32, Ptr, FixedArray, Layout } from "tint:ffi";
  type CC_LONG = u32;
  /** Plain words, no self-pointers: a context may live in a movable heap
   * buffer between leaf calls. */
  export interface CC_SHA256_CTX {
    count: FixedArray<CC_LONG, 2>;
    hash: FixedArray<CC_LONG, 8>;
    wbuf: FixedArray<CC_LONG, 16>;
  }
  export const CC_SHA256_CTX: Layout<CC_SHA256_CTX>;
  export function CC_SHA256_Init(c: Ptr<CC_SHA256_CTX>): i32;
  export function CC_SHA256_Update(
    c: Ptr<CC_SHA256_CTX>,
    data: Ptr<u8>,
    len: CC_LONG,
  ): i32;
  export function CC_SHA256_Final(md: Ptr<u8>, c: Ptr<CC_SHA256_CTX>): i32;
}
