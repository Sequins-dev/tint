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
  verifyMayCallbackOnlyFixture,
  verifyZlibCallbackFixture,
  withCallbackLibrary,
} from "./native-callback-fixtures.ts";
import { verifyZlibFixture } from "./native-zlib-fixtures.ts";
import {
  verifyDynamicFixture,
  withDynamicLibrary,
} from "./native-dynamic-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
test("a may-callback call in a program without callbacks finds its callback state", () => {
  verifyMayCallbackOnlyFixture();
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

const arm64Baseline = process.env.TINT_ARM64_FFI_BASELINE;
test(
  "arm64 static and dynamic FFI images match the baseline byte for byte",
  {
    skip:
      arm64Baseline === undefined
        ? "set TINT_ARM64_FFI_BASELINE to a built baseline source tree"
        : nativeFixtureTarget().arch !== "aarch64"
          ? "requires an arm64 target"
          : false,
  },
  () => {
    assert.ok(arm64Baseline);
    const baseline = arm64Baseline;
    function buildImage(
      root: string,
      fixture: string,
      library: string,
    ): Buffer {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { verifyAbiProbeFixture } from "./tools/native-ffi-fixtures.ts";
         import { verifyDynamicFixture } from "./tools/native-dynamic-fixtures.ts";
         const [fixture, library] = process.argv.slice(1);
         if (fixture === "ffi-dynamic") verifyDynamicFixture(library);
         else verifyAbiProbeFixture();`,
          fixture,
          library,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            TZ: "UTC",
            TINT_BUILD_ONLY: "1",
            TINT_GENERAL_FALLBACK: "0",
          },
          timeout: 120000,
        },
      );
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      const path = result.stdout
        .split("\n")
        .find((line) => line.endsWith("/" + fixture));
      assert.ok(path, result.stdout);
      return readFileSync(path);
    }
    const checked = withDynamicLibrary((library) => {
      for (const fixture of ["ffi-abi-probes", "ffi-dynamic"]) {
        const before = buildImage(baseline, fixture, library);
        const after = buildImage(process.cwd(), fixture, library);
        assert.ok(
          before.equals(after),
          fixture + " changed against the baseline",
        );
      }
      return true;
    });
    assert.equal(
      checked,
      true,
      "clang is required for the shared dynamic library",
    );
  },
);
