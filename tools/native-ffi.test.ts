// Native FFI (docs/native-ffi.md): leaf c-calls through binding
// declarations, executed under LLDB (stopped at entry, exit status 42).
import test from "node:test";
import {
  verifyAbiProbeFixture,
  verifyCryptoFixture,
  verifyStorageFixture,
} from "./native-ffi-fixtures.ts";
import { verifyDylibProbe } from "./ffi-dylib-probe.ts";
import { verifyZlibFixture } from "./native-zlib-fixtures.ts";
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
  "external storage, raw addresses and Field accessors work natively",
  storage,
  () => {
    verifyStorageFixture();
  },
);
