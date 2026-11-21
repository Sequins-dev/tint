// OpenSSL 3 public ABI. Tint resolves the selected system handle at runtime.
declare module "tint:c/openssl3" {
  import type { Address, Ptr, i32, u32, usize } from "tint:ffi";
  export function ERR_clear_error(): void;
  export function EVP_get_digestbyname(name: Ptr<void>): Address<void>;
  export function EVP_md_null(): Address<void>;
  export function EVP_MD_CTX_new(): Address<void>;
  export function EVP_MD_CTX_free(context: Address<void>): void;
  export function EVP_DigestInit_ex2(
    context: Address<void>,
    digest: Address<void>,
    params: Address<void>,
  ): i32;
  export function EVP_DigestUpdate(
    context: Address<void>,
    bytes: Ptr<void>,
    count: usize,
  ): i32;
  export function EVP_DigestFinal_ex(
    context: Address<void>,
    output: Ptr<void>,
    length: Ptr<u32>,
  ): i32;
  export function HMAC_CTX_new(): Address<void>;
  export function HMAC_CTX_free(context: Address<void>): void;
  export function HMAC_Init_ex(
    context: Address<void>,
    key: Ptr<void>,
    keyLength: i32,
    digest: Address<void>,
    engine: Address<void>,
  ): i32;
  export function HMAC_Update(
    context: Address<void>,
    bytes: Ptr<void>,
    count: usize,
  ): i32;
  export function HMAC_Final(
    context: Address<void>,
    output: Ptr<void>,
    length: Ptr<u32>,
  ): i32;
  export function RAND_bytes_ex(
    context: Address<void>,
    bytes: Ptr<void>,
    count: usize,
    strength: u32,
  ): i32;
}
