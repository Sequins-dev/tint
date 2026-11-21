import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BindingSpec } from "../spec.ts";

function includeDirectories(): string[] {
  const override = process.env.TINT_OPENSSL_INCLUDE;
  if (override !== undefined) return [override];
  if (process.platform !== "darwin") return [];
  const prefixes = ["/opt/homebrew", "/usr/local"];
  const prefix = process.env.HOMEBREW_PREFIX;
  if (prefix !== undefined) prefixes.unshift(prefix);
  const candidates = prefixes.map((path) =>
    join(path, "opt", "openssl@3", "include"),
  );
  const directory = candidates.find((path) =>
    existsSync(join(path, "openssl", "evp.h")),
  );
  return directory === undefined ? [] : [directory];
}

/** OpenSSL 3 leaf calls used by the native node:crypto implementation. */
export default {
  library: "openssl3",
  summary: [
    "OpenSSL 3 libcrypto. Tint resolves the selected system library at runtime.",
    "The adapter owns opaque contexts and borrows the byte windows only during each call.",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  linuxX86_64: {},
  includeDirectories: includeDirectories(),
  headers: [
    "openssl/err.h",
    "openssl/evp.h",
    "openssl/hmac.h",
    "openssl/rand.h",
  ],
  constants: ["EVP_MD_FLAG_XOF"],
  functions: [
    "ERR_clear_error",
    { name: "EVP_get_digestbyname", parameters: { 0: "CStringBytes" } },
    "EVP_md_null",
    "EVP_MD_CTX_new",
    { name: "EVP_MD_CTX_free", parameters: { 0: "Address" } },
    { name: "EVP_MD_CTX_reset", parameters: { 0: "Address" } },
    { name: "EVP_MD_get_flags", parameters: { 0: "Address" } },
    {
      name: "EVP_DigestInit_ex2",
      parameters: { 0: "Address", 1: "Address", 2: "Address" },
    },
    { name: "EVP_DigestUpdate", parameters: { 0: "Address" } },
    { name: "EVP_DigestFinal_ex", parameters: { 0: "Address" } },
    "HMAC_CTX_new",
    { name: "HMAC_CTX_free", parameters: { 0: "Address" } },
    { name: "HMAC_CTX_reset", parameters: { 0: "Address" } },
    {
      name: "HMAC_Init_ex",
      parameters: { 0: "Address", 3: "Address", 4: "Address" },
    },
    { name: "HMAC_Update", parameters: { 0: "Address" } },
    { name: "HMAC_Final", parameters: { 0: "Address" } },
    { name: "RAND_bytes_ex", parameters: { 0: "Address" } },
  ],
} satisfies BindingSpec;
