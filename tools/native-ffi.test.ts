// Native FFI (docs/native-ffi.md): leaf c-calls through binding
// declarations, executed under LLDB (stopped at entry, exit status 42).
import test from "node:test";
import {
  verifyAbiProbeFixture,
  verifyAvailabilityFixture,
  verifyCryptoFixture,
  verifyStorageFixture,
  verifyViewFixture,
} from "./native-ffi-fixtures.ts";
import { verifyDylibProbe } from "./ffi-dylib-probe.ts";
import { verifyZlibFixture } from "./native-zlib-fixtures.ts";

test("libSystem ABI probes observe every C call shape natively", () => {
  verifyAbiProbeFixture();
});
test("createHash('sha256') over CommonCrypto matches Node's digests under GC churn", () => {
  verifyCryptoFixture();
});
test("images load libraries beyond libSystem and bind absent optional symbols as 0", () => {
  verifyDylibProbe();
});
test("availability queries see absent and present optional libraries", () => {
  verifyAvailabilityFixture();
});
test("node:zlib sync codecs match the system zlib and Node under GC (generational)", () => {
  verifyZlibFixture();
});
test("node:zlib sync codecs match the system zlib and Node under GC (copying)", () => {
  verifyZlibFixture("initializeCopyingRuntime");
});
test("external storage and raw addresses work natively", () => {
  verifyStorageFixture();
});
test("C views read and write records as properties under GC (generational)", () => {
  verifyViewFixture();
});
test("C views read and write records as properties under GC (copying)", () => {
  verifyViewFixture("initializeCopyingRuntime");
});
