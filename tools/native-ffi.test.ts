// Native FFI (docs/native-ffi.md): leaf c-calls, views, dynamic calls, and
// callbacks through binding declarations, executed under LLDB (stopped at
// entry, exit status 42). Compatible typed cases share one `argv`-dispatched
// binary; callback contract trap scenarios share a second binary.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { darwinSystemLibrary } from "@tint/abi/c";
import {
  abiProbeFixtureSource,
  cryptoFixtureSource,
  foreignDeclarations,
  foreignFixtureSource,
  probeDeclarations,
  probeMathDeclarations,
  storageDeclarations,
  storageFixtureSource,
  verifyAvailabilityFixture,
  viewDeclarations,
  viewFixtureSource,
} from "./native-ffi-fixtures.ts";
import { verifyDylibProbe } from "./ffi-dylib-probe.ts";
import {
  verifyCryptoAsyncFixture,
  verifyCryptoPublicFixture,
} from "./build-node-crypto-async-fixture.ts";
import {
  callbackDeclarations,
  callbackFixtureSource,
  callbackLibrarySource,
  prepareCallbackTrapSuite,
  verifyCallbackTrapCase,
  verifyMayCallbackOnlyFixture,
  zlibCallbackDeclarations,
  zlibCallbackSource,
} from "./native-callback-fixtures.ts";
import { zlibFixtureSource } from "./native-zlib-fixtures.ts";
import {
  buildDynamicLibrary,
  dynamicFixtureSource,
  dynamicSymbolWordsSource,
  withDynamicLibrary,
} from "./native-dynamic-fixtures.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  prepareHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";
import { withNativeFixtureMemory } from "./gate/native-fixture.ts";
import { stableScratchDirectory } from "./fixture-scratch.ts";
import {
  cleanupNativeBinary,
  nodeProcessModule,
  parseFixtureModule,
  runNativeSuiteCase,
  typedCaseDispatcher,
} from "./native-suite-runner.ts";

/** The dylib probe inspects Mach-O weak dylib binding; ELF images load
 * optional libraries with dlopen at first use instead (the availability
 * fixture covers both). */
const optionalLibraries =
  nativeFixtureTarget().os === "darwin"
    ? {}
    : {
        skip: "the probe checks Mach-O weak dylib binding; ELF images dlopen optional libraries",
      };
/** ARM64 ABI probes (Apple packed stack and AAPCS64 register/stack);
 * x86-64 SysV ABI call shapes are covered by native-x64-ffi.test.ts. */
const arm64Abi =
  nativeFixtureTarget().arch === "aarch64"
    ? {}
    : {
        skip: "ARM64 ABI probes (x86-64 SysV ABI is covered by native-x64-ffi.test.ts)",
      };

/** Dynamic calls load a C library clang builds at test time. */
const clang =
  spawnSync("clang", ["--version"], { encoding: "utf8" }).status === 0
    ? {}
    : { skip: "clang is not installed (the test library is compiled)" };

const ffiModule = "packages/native-runtime/src/ffi/index.ts";
const ffiUnsafeModule = "packages/native-runtime/src/ffi/unsafe.ts";
const memoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
const cryptoModule = "packages/native-runtime/src/node/crypto.ts";
const zlibModule = "packages/native-runtime/src/node/zlib.ts";

/** Re-namespace a `tint:c/libsystem` declaration so several fixtures with
 * distinct overloads (e.g. `strlen(CString)` vs `strlen(Address<char>)`)
 * coexist in one compiled binary without extra load commands. */
function systemDeclaration(
  declaration: FixtureForeignDeclaration,
  moduleName: string,
): FixtureForeignDeclaration {
  const replaced = declaration.text.replace(
    'declare module "tint:c/libsystem"',
    `declare module "${moduleName}"`,
  );
  assert.notEqual(
    replaced,
    declaration.text,
    `expected tint:c/libsystem declaration in ${declaration.id}`,
  );
  return {
    id: declaration.id,
    text: replaced,
    manifest: [
      {
        module: moduleName,
        darwin: {
          name: darwinSystemLibrary,
          optional: false,
          currentVersion: 0x10000,
          compatibilityVersion: 0x10000,
        },
        linux: {
          name: "libc.so.6",
          optional: false,
          currentVersion: 0,
          compatibilityVersion: 0,
        },
      },
    ],
  };
}

let typedSuiteBinary: string | undefined;
function ffiTypedSuite(): string {
  if (typedSuiteBinary !== undefined) return typedSuiteBinary;
  const includeArm64Probes = nativeFixtureTarget().arch === "aarch64";
  const suiteProbeDecl = systemDeclaration(
    probeDeclarations,
    "tint:c/ffi-suite-probe",
  );
  const suiteStorageDecl = systemDeclaration(
    storageDeclarations,
    "tint:c/ffi-suite-storage",
  );
  const suiteViewDecl = systemDeclaration(
    viewDeclarations,
    "tint:c/ffi-suite-views",
  );
  const suiteForeignDecl = systemDeclaration(
    foreignDeclarations,
    "tint:c/ffi-suite-foreign",
  );
  const suiteCallbackDecl = systemDeclaration(
    callbackDeclarations,
    "tint:c/ffi-suite-callbacks",
  );
  const cases: {
    readonly name: string;
    readonly specifier: string;
    readonly id: string;
    readonly text: string;
    readonly deps: readonly [string, string][];
  }[] = [
    ...(includeArm64Probes
      ? [
          {
            name: "abi-probes",
            specifier: "./abi-probes.ts",
            id: "fixture:ffi-abi-probes",
            text: abiProbeFixtureSource(),
            deps: [
              ["probe", suiteProbeDecl.id],
              ["probe-math", probeMathDeclarations.id],
            ] as [string, string][],
          },
        ]
      : []),
    {
      name: "crypto",
      specifier: "./crypto.ts",
      id: "fixture:ffi-crypto",
      text: cryptoFixtureSource(),
      deps: [["node:crypto", cryptoModule]],
    },
    {
      name: "zlib",
      specifier: "./zlib.ts",
      id: "fixture:ffi-zlib",
      text: zlibFixtureSource(),
      deps: [
        ["node:zlib", zlibModule],
        ["node:crypto", cryptoModule],
      ],
    },
    {
      name: "storage",
      specifier: "./storage.ts",
      id: "fixture:ffi-storage",
      text: storageFixtureSource(),
      deps: [
        ["tint:ffi", ffiModule],
        ["tint:ffi/unsafe", ffiUnsafeModule],
        ["ffi-internal", ffiModule],
        ["storage", suiteStorageDecl.id],
      ],
    },
    {
      name: "views",
      specifier: "./views.ts",
      id: "fixture:ffi-views",
      text: viewFixtureSource(),
      deps: [
        ["tint:ffi", ffiModule],
        ["views", suiteViewDecl.id],
      ],
    },
    {
      name: "foreign",
      specifier: "./foreign.ts",
      id: "fixture:ffi-foreign",
      text: foreignFixtureSource(),
      deps: [
        ["tint:ffi", ffiModule],
        ["tint:ffi/unsafe", ffiUnsafeModule],
        ["foreign", suiteForeignDecl.id],
      ],
    },
    {
      name: "dynamic-symbol-words",
      specifier: "./dynamic-symbol-words.ts",
      id: "fixture:ffi-dynamic-symbol-words",
      text: dynamicSymbolWordsSource(undefined),
      deps: [
        ["tint:ffi/unsafe", ffiUnsafeModule],
        ["node:process", nodeProcessModule],
      ],
    },
    {
      name: "dynamic",
      specifier: "./dynamic.ts",
      id: "fixture:ffi-dynamic",
      text: dynamicFixtureSource(undefined),
      deps: [
        ["tint:ffi/unsafe", ffiUnsafeModule],
        ["tint:ffi", ffiModule],
        ["node:process", nodeProcessModule],
      ],
    },
    {
      name: "callbacks",
      specifier: "./callbacks.ts",
      id: "fixture:ffi-callbacks",
      text: callbackFixtureSource(),
      deps: [
        ["tint:ffi", ffiModule],
        ["tint:ffi/unsafe", ffiUnsafeModule],
        ["callbacks", suiteCallbackDecl.id],
        ["gc", memoryModule],
      ],
    },
    {
      name: "zlib-callbacks",
      specifier: "./zlib-callbacks.ts",
      id: "fixture:ffi-zlib-callbacks",
      text: zlibCallbackSource(),
      deps: [
        ["tint:ffi", ffiModule],
        ["zlib", zlibCallbackDeclarations.id],
        ["gc", memoryModule],
      ],
    },
  ];
  typedSuiteBinary = prepareHostedFixture(
    typedCaseDispatcher(cases),
    "ffi-typed-suite",
    [
      ["node:process", nodeProcessModule],
      ...cases.map(({ specifier, id }): [string, string] => [specifier, id]),
    ],
    cases.map(({ id, text, deps }) => parseFixtureModule(id, text, deps)),
    [],
    [],
    {
      requireTyped: true,
      managedBytes: 16777216,
      allocationCapacity: 262144,
      foreignDeclarations: [
        ...(includeArm64Probes ? [suiteProbeDecl, probeMathDeclarations] : []),
        suiteStorageDecl,
        suiteViewDecl,
        suiteForeignDecl,
        suiteCallbackDecl,
        zlibCallbackDeclarations,
      ],
    },
  );
  return typedSuiteBinary;
}

let dynamicLibraryDir: string | undefined;
let dynamicLibraryPath: string | undefined;
function sharedDynamicLibrary(): string {
  if (dynamicLibraryPath !== undefined) return dynamicLibraryPath;
  const dir = stableScratchDirectory("ffi-dynamic-library");
  const library = buildDynamicLibrary(dir);
  assert.ok(library, "clang is required");
  dynamicLibraryDir = dir;
  dynamicLibraryPath = library;
  return library;
}

let callbackLibraryDir: string | undefined;
let callbackTrapSuiteBinary: string | undefined;
function callbackTrapSuite(): string {
  if (callbackTrapSuiteBinary !== undefined) return callbackTrapSuiteBinary;
  const dir = stableScratchDirectory("ffi-callback-traps-library");
  const source = join(dir, "callback-traps.c");
  const library = join(
    dir,
    nativeFixtureTarget().os === "darwin"
      ? "libtint-callback-traps.dylib"
      : "libtint-callback-traps.so",
  );
  writeFileSync(source, callbackLibrarySource);
  const built = withNativeFixtureMemory(() =>
    spawnSync(
      "clang",
      ["-O1", "-shared", "-fPIC", "-pthread", "-o", library, source],
      { encoding: "utf8" },
    ),
  );
  if (built.status !== 0) throw Error("clang failed:\n" + built.stderr);
  callbackLibraryDir = dir;
  callbackTrapSuiteBinary = prepareCallbackTrapSuite(library);
  return callbackTrapSuiteBinary;
}

after(() => {
  cleanupNativeBinary(typedSuiteBinary);
  cleanupNativeBinary(callbackTrapSuiteBinary);
  if (dynamicLibraryDir !== undefined)
    rmSync(dynamicLibraryDir, { recursive: true, force: true });
  if (callbackLibraryDir !== undefined)
    rmSync(callbackLibraryDir, { recursive: true, force: true });
});

test(
  "C library ABI probes observe every C call shape natively",
  arm64Abi,
  () => {
    runNativeSuiteCase(ffiTypedSuite(), ["abi-probes"]);
  },
);
test("node:crypto hashes, HMAC and random bytes use system OpenSSL", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["crypto"]);
});
test("node:crypto PBKDF2 returns through the blocking pool and reactor wake", () => {
  verifyCryptoAsyncFixture();
});
test("node:crypto imports share Buffer identity and reject unsupported operations", () => {
  verifyCryptoPublicFixture();
});
test(
  "images load libraries beyond libSystem and bind absent optional symbols as 0",
  optionalLibraries,
  () => {
    verifyDylibProbe();
  },
);
test("node:zlib sync codecs match the system zlib and Node under GC", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["zlib"]);
});
test("optional libraries: availability and calls for absent and present ones", () => {
  verifyAvailabilityFixture();
});
test("external storage and raw addresses work natively", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["storage"]);
});
test("C views read and write records as properties under GC", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["views"]);
});
test("tint:ffi/unsafe views read C-owned memory across collections", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["foreign"]);
});
test("dynamic symbol lookup preserves exact address words", clang, () => {
  runNativeSuiteCase(ffiTypedSuite(), [
    "dynamic-symbol-words",
    sharedDynamicLibrary(),
  ]);
});
test("dynamic calls reach every C argument and result class", clang, () => {
  runNativeSuiteCase(ffiTypedSuite(), ["dynamic", sharedDynamicLibrary()]);
});
test("callbacks: qsort over records, nesting, GC inside and exceptions", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["callbacks"]);
});
test("a may-callback call in a program without callbacks finds its callback state", () => {
  verifyMayCallbackOnlyFixture();
});
test("registered callbacks: zlib's allocator round trip under GC", () => {
  runNativeSuiteCase(ffiTypedSuite(), ["zlib-callbacks"]);
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
      verifyCallbackTrapCase(callbackTrapSuite(), scenario);
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
