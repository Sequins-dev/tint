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
import { nativeFixtureTarget } from "./native-host-target.ts";

/** These fixtures exercise Darwin facilities; other targets skip them with
 * the reason (docs/linux-aarch64-target.md, "Not yet supported"). */
const darwin = nativeFixtureTarget().os === "darwin";
function darwinOnly(reason: string): { skip?: string } {
  return darwin ? {} : { skip: reason };
}
const storage = darwinOnly(
  "tint:ffi external storage uses Darwin mapping flags",
);

test(
  "libSystem ABI probes observe every C call shape natively",
  darwinOnly(
    "the probes bind libSystem declarations (cabs is in libm on glibc)",
  ),
  () => {
    verifyAbiProbeFixture();
  },
);
test(
  "createHash('sha256') over CommonCrypto matches Node's digests under GC churn",
  darwinOnly("CommonCrypto is a Darwin library"),
  () => {
    verifyCryptoFixture();
  },
);
test(
  "images load libraries beyond libSystem and bind absent optional symbols as 0",
  darwinOnly(
    "optional libraries are Mach-O weak dylibs; ELF images reject them",
  ),
  () => {
    verifyDylibProbe();
  },
);
test(
  "node:zlib sync codecs match the system zlib and Node under GC (generational)",
  storage,
  () => {
    verifyZlibFixture();
  },
);
test(
  "node:zlib sync codecs match the system zlib and Node under GC (copying)",
  storage,
  () => {
    verifyZlibFixture("initializeCopyingRuntime");
  },
);
test(
  "availability queries see absent and present optional libraries",
  darwinOnly(
    "optional libraries are Mach-O weak dylibs; ELF images reject them",
  ),
  () => {
    verifyAvailabilityFixture();
  },
);
test(
  "external storage and raw addresses work natively (generational)",
  storage,
  () => {
    verifyStorageFixture();
  },
);
test(
  "external storage and raw addresses work natively (copying)",
  storage,
  () => {
    verifyStorageFixture("initializeCopyingRuntime");
  },
);
test("C views read and write records as properties under GC (generational)", () => {
  verifyViewFixture();
});
test("C views read and write records as properties under GC (copying)", () => {
  verifyViewFixture("initializeCopyingRuntime");
});
test(
  "tint:ffi/unsafe views read C-owned memory across collections (generational)",
  storage,
  () => {
    verifyForeignFixture();
  },
);
test(
  "tint:ffi/unsafe views read C-owned memory across collections (copying)",
  storage,
  () => {
    verifyForeignFixture("initializeCopyingRuntime");
  },
);
const darwinOs = darwinOnly(
  "node:os binds Darwin's passwd, ifaddrs and sockaddr layouts",
);
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
