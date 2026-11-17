// Native FFI (docs/native-ffi.md): leaf c-calls through binding
// declarations, executed under LLDB (stopped at entry, exit status 42).
import test from "node:test";
import {
  verifyAbiProbeFixture,
  verifyAvailabilityFixture,
  verifyCryptoFixture,
  verifyForeignFixture,
  verifyStorageFixture,
  verifyViewFixture,
} from "./native-ffi-fixtures.ts";
import { verifyDylibProbe } from "./ffi-dylib-probe.ts";
import { verifyZlibFixture } from "./native-zlib-fixtures.ts";
import { verifyOsFixture } from "./native-os-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
test("tint:ffi/unsafe views read C-owned memory across collections (generational)", () => {
  verifyForeignFixture();
});
test("tint:ffi/unsafe views read C-owned memory across collections (copying)", () => {
  verifyForeignFixture("initializeCopyingRuntime");
});
/** node:os binds Darwin's records (tint:c/darwin-os); on linux-arm64 it
 * fails explicitly (tested below). */
const darwinOs =
  nativeFixtureTarget().os === "darwin"
    ? {}
    : { skip: "node:os binds Darwin's passwd, ifaddrs and sockaddr layouts" };
test(
  "node:os userInfo, networkInterfaces and loadavg match Node (generational)",
  darwinOs,
  () => {
    verifyOsFixture();
  },
);
test(
  "node:os userInfo, networkInterfaces and loadavg match Node (copying)",
  darwinOs,
  () => {
    verifyOsFixture("initializeCopyingRuntime");
  },
);
test("node:os fails explicitly on linux-arm64 (tint:c/darwin-os is Darwin-only)", () => {
  // No silent misreading of glibc's records: resolution rejects the import.
  // The fixture target is fixed when hosted-fixture.ts loads, so the Linux
  // build runs in a child process.
  const script = `import { osFixtureSource } from ${JSON.stringify(
    new URL("./native-os-fixtures.ts", import.meta.url).href,
  )};
import { verifyHostedFixture } from ${JSON.stringify(
    new URL("./hosted-fixture.ts", import.meta.url).href,
  )};
verifyHostedFixture(osFixtureSource(""), "node-os-linux", [["node:os", "packages/native-runtime/src/node/os.ts"]]);`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TINT_NATIVE_TARGET: "linux-aarch64",
        TINT_BUILD_ONLY: "1",
      },
    },
  );
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(
    result.stderr,
    /"stage":"resolve","module":"packages\/native-runtime\/src\/node\/os.ts","message":"UNDECLARED_IMPORT: tint:c\/darwin-os"/,
  );
});
