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
import { nativeFixtureTarget } from "./native-host-target.ts";

/** Optional libraries are Mach-O weak dylibs; ELF images reject them and
 * load required ones through DT_NEEDED (docs/linux-aarch64-target.md,
 * "Libraries"), which the libm probe and the zlib fixtures exercise. */
const optionalLibraries =
  nativeFixtureTarget().os === "darwin"
    ? {}
    : {
        skip: "optional libraries are Mach-O weak dylibs; ELF images reject them",
      };

test("C library ABI probes observe every C call shape natively", () => {
  verifyAbiProbeFixture();
});
test("createHash('sha256') matches Node's digests under GC churn", () => {
  verifyCryptoFixture();
});
test(
  "images load libraries beyond libSystem and bind absent optional symbols as 0",
  optionalLibraries,
  () => {
    verifyDylibProbe();
  },
);
test("node:zlib sync codecs match the system zlib and Node under GC (generational)", () => {
  verifyZlibFixture();
});
test("node:zlib sync codecs match the system zlib and Node under GC (copying)", () => {
  verifyZlibFixture("initializeCopyingRuntime");
});
test(
  "availability queries see absent and present optional libraries",
  optionalLibraries,
  () => {
    verifyAvailabilityFixture();
  },
);
test("external storage and raw addresses work natively (generational)", () => {
  verifyStorageFixture();
});
test("external storage and raw addresses work natively (copying)", () => {
  verifyStorageFixture("initializeCopyingRuntime");
});
test("C views read and write records as properties under GC (generational)", () => {
  verifyViewFixture();
});
test("C views read and write records as properties under GC (copying)", () => {
  verifyViewFixture("initializeCopyingRuntime");
});
