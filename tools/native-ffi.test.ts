// Native FFI (docs/native-ffi.md): leaf c-calls through binding
// declarations, executed under LLDB (stopped at entry, exit status 42).
import test from "node:test";
import {
  verifyAbiProbeFixture,
  verifyCryptoFixture,
} from "./native-ffi-fixtures.ts";

test("libSystem ABI probes observe every C call shape natively", () => {
  verifyAbiProbeFixture();
});
test("createHash('sha256') over CommonCrypto matches Node's digests under GC churn", () => {
  verifyCryptoFixture();
});
