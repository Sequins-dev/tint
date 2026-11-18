import type { BindingSpec } from "../spec.ts";

/** CommonCrypto's SHA-256 behind `crypto.createHash('sha256')` on Darwin. */
export default {
  library: "commoncrypto",
  summary: [
    "CommonCrypto message digests (<CommonCrypto/CommonDigest.h>), resolved",
    "through libSystem's re-exports.",
  ],
  targets: ["darwin-arm64"],
  headers: ["CommonCrypto/CommonDigest.h"],
  aliases: ["CC_LONG"],
  records: [
    {
      name: "CC_SHA256_CTX",
      doc: "Plain words, no self-pointers: a context may live in a movable heap buffer between leaf calls.",
    },
  ],
  functions: ["CC_SHA256_Init", "CC_SHA256_Update", "CC_SHA256_Final"],
} satisfies BindingSpec;
