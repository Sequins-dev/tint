import { test } from "node:test";
import assert from "node:assert/strict";
import { darwinArm64CTarget, linuxArm64CTarget } from "@tint/abi/c";
import { buildExecutable } from "@tint/image/darwin/macho";
import type { ExecutableImageRequest } from "@tint/image/executable";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  nativeTargetNamed,
} from "@tint/platform/target";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { buildMacOSProgram, type BuildRequest } from "../src/build.ts";
import { writeExecutableImage } from "../src/image-writer.ts";
import type { ForeignLibrary } from "../src/native/index.ts";

// mov w0, #42; ret
const code = new Uint8Array([0x40, 5, 0x80, 0x52, 0xc0, 3, 0x5f, 0xd6]);

test("targets are named and carry their C ABI, host ABI and image facts", () => {
  assert.equal(nativeTargetNamed("darwin-aarch64"), darwinAArch64Target);
  assert.equal(nativeTargetNamed("linux-aarch64"), linuxAArch64Target);
  assert.equal(nativeTargetNamed("darwin-arm64"), undefined);
  assert.equal(darwinAArch64Target.c, darwinArm64CTarget);
  assert.deepEqual(darwinAArch64Target.hostABI, darwinHostABI());
  assert.equal(darwinAArch64Target.segmentAlignment, 16384);
  assert.equal(darwinAArch64Target.memoryPageBytes, 16384);
  assert.equal(linuxAArch64Target.c, linuxArm64CTarget);
  assert.equal(linuxAArch64Target.objectFormat, "elf");
  // 64K covers kernels with 4K, 16K and 64K pages.
  assert.equal(linuxAArch64Target.segmentAlignment, 65536);
  assert.equal(linuxAArch64Target.memoryPageBytes, 65536);
  assert.equal(linuxAArch64Target.hostABI, undefined);
});

test("builds for a target without a host ABI fail before compiling", () => {
  const stages: string[] = [];
  const request: BuildRequest = {
    target: linuxAArch64Target,
    modules: [],
    entry: "main",
    start: "run",
    runtimes: [],
    hostBindings: [],
    allocatorModule: "allocator",
    runtimeModule: "runtime",
    memoryModule: "memory",
    identifier: "target-test",
    managedBytes: 4096,
    controlBytes: 4096,
    allocationCapacity: 16,
    rootCapacity: 16,
    stackBytes: 4096,
    report: (stage) => stages.push(stage),
  };
  assert.deepEqual(buildMacOSProgram(request), {
    ok: false,
    error: { stage: "target", message: "linux-aarch64 has no host ABI yet" },
  });
  assert.deepEqual(stages, []);
});

function foreignLibrary(
  name: string,
  currentVersion: number,
  compatibilityVersion: number,
): ForeignLibrary {
  return {
    id: "tint:c/test",
    declaration: { functions: [] },
    stubs: [],
    image: { name, optional: false, currentVersion, compatibilityVersion },
  } as unknown as ForeignLibrary;
}

test("the image writer dispatches on the target's object format", () => {
  const image: ExecutableImageRequest = {
    code,
    entryOffset: 0,
    maxByteLength: 1 << 20,
    imports: ["_getpid", "_zlibVersion"],
    libraries: [
      { name: "/usr/lib/libz.1.dylib", weak: false, symbols: ["_zlibVersion"] },
    ],
  };
  const libraries = [foreignLibrary("/usr/lib/libz.1.dylib", 0x10203, 0x10000)];
  assert.deepEqual(
    writeExecutableImage(linuxAArch64Target, image, "tint.test", libraries),
    {
      ok: false,
      error: "linux-aarch64 executable images (ELF) are not implemented",
    },
  );
  // Mach-O: the target supplies the deployment versions and the foreign
  // libraries their load-command version words.
  const written = writeExecutableImage(
    darwinAArch64Target,
    image,
    "tint.test",
    libraries,
  );
  const expected = buildExecutable({
    ...image,
    identifier: "tint.test",
    minimumOS: { major: 14, minor: 0, patch: 0 },
    sdk: { major: 15, minor: 0, patch: 0 },
    dylibVersions: [
      {
        name: "/usr/lib/libz.1.dylib",
        currentVersion: 0x10203,
        compatibilityVersion: 0x10000,
      },
    ],
  });
  assert.ok(written.ok && expected.ok);
  assert.deepEqual(written.value, expected.value.bytes);
  assert.deepEqual(
    writeExecutableImage(darwinAArch64Target, image, "tint.test", []),
    { ok: false, error: "library /usr/lib/libz.1.dylib" },
  );
});
