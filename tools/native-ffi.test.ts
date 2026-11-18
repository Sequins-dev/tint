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
import {
  verifyCallbackFixture,
  verifyCallbackTrap,
  verifyZlibCallbackFixture,
  withCallbackLibrary,
} from "./native-callback-fixtures.ts";
import { verifyZlibFixture } from "./native-zlib-fixtures.ts";
import { verifyOsFixture } from "./native-os-fixtures.ts";
import {
  verifyDynamicFixture,
  withDynamicLibrary,
} from "./native-dynamic-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { nativeFixtureTarget } from "./native-host-target.ts";

/** The dylib probe inspects Mach-O weak dylib binding; ELF images load
 * optional libraries with dlopen at first use instead (the availability
 * fixture covers both). */
const optionalLibraries =
  nativeFixtureTarget().os === "darwin"
    ? {}
    : {
        skip: "the probe checks Mach-O weak dylib binding; ELF images dlopen optional libraries",
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
test("optional libraries: availability and calls for absent and present ones", () => {
  verifyAvailabilityFixture();
});
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
test("node:os userInfo, networkInterfaces and loadavg match Node (generational)", () => {
  verifyOsFixture();
});
test("node:os userInfo, networkInterfaces and loadavg match Node (copying)", () => {
  verifyOsFixture("initializeCopyingRuntime");
});
/** Build `module` as node:os for `target` in a child process (the fixture
 * target is fixed when hosted-fixture.ts loads). */
function buildOsFor(module: string, target: string) {
  const script = `import { osFixtureSource } from ${JSON.stringify(
    new URL("./native-os-fixtures.ts", import.meta.url).href,
  )};
import { verifyHostedFixture } from ${JSON.stringify(
    new URL("./hosted-fixture.ts", import.meta.url).href,
  )};
verifyHostedFixture(osFixtureSource(""), "node-os-other", [["node:os", ${JSON.stringify(module)}]]);`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, TINT_NATIVE_TARGET: target, TINT_BUILD_ONLY: "1" },
  });
}
test("each target's node:os fails explicitly on the other target", () => {
  // No silent misreading of the other C library's records: resolution
  // rejects the binding import.
  for (const [module, target, binding] of [
    ["os-darwin.ts", "linux-aarch64", "darwin-os"],
    ["os-linux.ts", "darwin-aarch64", "linux-os"],
  ] as const) {
    const result = buildOsFor(
      "packages/native-runtime/src/node/" + module,
      target,
    );
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(
      result.stderr.includes(
        `"stage":"resolve","module":"packages/native-runtime/src/node/${module}","message":"UNDECLARED_IMPORT: tint:c/${binding}"`,
      ),
      result.stderr.slice(-2000),
    );
  }
});
/** Dynamic calls load a C library clang builds at test time. */
const clang =
  spawnSync("clang", ["--version"], { encoding: "utf8" }).status === 0
    ? {}
    : { skip: "clang is not installed (the test library is compiled)" };
test(
  "dynamic calls reach every C argument and result class (generational)",
  clang,
  () => {
    withDynamicLibrary((library) => verifyDynamicFixture(library));
  },
);
test(
  "dynamic calls reach every C argument and result class (copying)",
  clang,
  () => {
    withDynamicLibrary((library) =>
      verifyDynamicFixture(library, "initializeCopyingRuntime"),
    );
  },
);
test("callbacks: qsort over records, nesting, GC inside and exceptions (generational)", () => {
  verifyCallbackFixture();
});
test("callbacks: qsort over records, nesting, GC inside and exceptions (copying)", () => {
  verifyCallbackFixture("initializeCopyingRuntime");
});
test("registered callbacks: zlib's allocator round trip under GC (generational)", () => {
  verifyZlibCallbackFixture();
});
test("registered callbacks: zlib's allocator round trip under GC (copying)", () => {
  verifyZlibCallbackFixture("initializeCopyingRuntime");
});
for (const scenario of [
  "ok",
  "leaf-later",
  "leaf-inside",
  "thread",
  "view-escape",
] as const)
  test(
    scenario === "ok"
      ? "callback contract: a may-callback call's callback runs"
      : "callback contract violation traps: " + scenario,
    clang,
    () => {
      withCallbackLibrary((library) => verifyCallbackTrap(library, scenario));
    },
  );
