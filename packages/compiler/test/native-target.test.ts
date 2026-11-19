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
import { linuxHostABI } from "@tint/platform/linux/host-abi";
import type { PosixHostABI } from "@tint/abi/host";
import { buildMacOSProgram, type BuildRequest } from "../src/build.ts";
import { writeExecutableImage } from "../src/image-writer.ts";
import {
  compileNativeProgram,
  type ForeignLibrary,
} from "../src/native/index.ts";
import { parseCompilerArguments } from "../src/cli-arguments.ts";

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
  assert.deepEqual(linuxAArch64Target.hostABI, linuxHostABI());
  assert.equal(linuxAArch64Target.interpreter, "/lib/ld-linux-aarch64.so.1");
});

function request(modules: BuildRequest["modules"] = []): BuildRequest {
  return {
    target: linuxAArch64Target,
    modules,
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
    report: () => {},
  };
}
function withoutExecutableMemory(host: PosixHostABI): PosixHostABI {
  const { executableMemory, ...rest } = host;
  assert.ok(executableMemory);
  return rest;
}
test("facilities a target lacks fail before compiling", () => {
  const stages: string[] = [];
  // Both supported targets publish live code; a host ABI without the
  // facility is rejected before compilation.
  assert.equal(linuxHostABI().executableMemory?.kind, "linux-dual-mapping");
  assert.deepEqual(
    buildMacOSProgram({
      ...request(),
      target: {
        ...linuxAArch64Target,
        hostABI: withoutExecutableMemory(linuxHostABI()),
      },
      allowJit: true,
      hostBindings: [
        { module: "memory", name: "map", operation: "executable-map" },
      ],
      report: (stage) => stages.push(stage),
    }),
    {
      ok: false,
      error: {
        stage: "target",
        message:
          "linux-aarch64 has no executable-memory (live code) publication",
      },
    },
  );
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
  // ELF: imports are verbatim and every library is DT_NEEDED; optional
  // libraries have no ELF form and are rejected.
  const elf = writeExecutableImage(
    linuxAArch64Target,
    {
      ...image,
      imports: ["getpid", "zlibVersion"],
      libraries: [{ name: "libz.so.1", weak: false, symbols: ["zlibVersion"] }],
    },
    "tint.test",
    [],
  );
  assert.ok(elf.ok, JSON.stringify(elf));
  assert.deepEqual([...elf.value.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
  const text = new TextDecoder("latin1").decode(elf.value);
  for (const name of [
    "/lib/ld-linux-aarch64.so.1",
    "libc.so.6",
    "libz.so.1",
    "zlibVersion",
  ])
    assert.ok(text.includes(name), name);
  assert.deepEqual(
    writeExecutableImage(
      linuxAArch64Target,
      {
        ...image,
        imports: ["zlibVersion"],
        libraries: [
          { name: "libz.so.1", weak: true, symbols: ["zlibVersion"] },
        ],
      },
      "tint.test",
      [],
    ),
    {
      ok: false,
      error:
        "optional library libz.so.1 cannot be loaded by linux-aarch64 images",
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

test("image writers place deferred code and patches at final offsets", () => {
  const payload = new Uint8Array(0x18000);
  payload.set(code);
  // A patch window straddles the first Mach-O signing chunk.
  payload.set([1, 2, 3, 4, 5, 6, 7, 8], 0xfffc);
  const expectedCode = payload.slice();
  expectedCode[0x10001] = 42;
  const request = { entryOffset: 0, maxByteLength: 1 << 20 };
  for (const [target, layout] of [
    [darwinAArch64Target, undefined],
    [
      darwinAArch64Target,
      { compactVMLimit: 0x10000, signedChunkBytes: 0x10000 },
    ],
    [linuxAArch64Target, undefined],
  ] as const) {
    const expected = writeExecutableImage(
      target,
      { ...request, code: expectedCode },
      "tint.placement",
      [],
      layout,
    );
    const actual = writeExecutableImage(
      target,
      {
        ...request,
        code: new Uint8Array(0),
        codePlan: {
          byteLength: payload.length,
          write(output, base) {
            output.write(payload, base);
            return output.patch(base + 0xfffc, 8, (bytes, at) => {
              assert.equal(bytes[at], 1);
              assert.equal(bytes[at + 7], 8);
              bytes[at + 5] = 42;
              return undefined;
            });
          },
        },
      },
      "tint.placement",
      [],
      layout,
    );
    assert.equal(expected.ok, true);
    assert.deepEqual(actual, expected);
    assert.equal(payload[0x10001], 6);
  }
});

test("an explicit x86-64 target reaches the native backend dispatch", () => {
  const parsed = parseCompilerArguments(
    ["src", "out", "--target", "linux-x86_64"],
    darwinAArch64Target,
  );
  assert.ok(parsed);
  const target = parsed.target;
  assert.equal(target.name, "linux-x86_64");
  assert.equal(target.arch, "x86_64");
  assert.equal(target.objectFormat, "elf");
  assert.equal(target.segmentAlignment, 4096);
  assert.equal(target.memoryPageBytes, 4096);
  assert.equal(target.hostABI.parking?.kind, "linux-futex");
  if (target.hostABI.parking?.kind === "linux-futex")
    assert.equal(target.hostABI.parking.futexSyscall, 202);
  assert.equal(target.interpreter, "/lib64/ld-linux-x86-64.so.2");

  const expected = {
    ok: false,
    error: {
      stage: "emit",
      message: "linux-x86_64: x86_64 code generation is not implemented yet",
    },
  };
  assert.deepEqual(buildMacOSProgram({ ...request(), target }), expected);
  assert.deepEqual(
    compileNativeProgram(
      { modules: [], entry: "main", exports: [], runtimes: [] },
      target,
    ),
    expected,
  );
});

test("the ELF image writer preserves the selected x86-64 machine", () => {
  const target = nativeTargetNamed("linux-x86_64");
  assert.ok(target);
  const image = writeExecutableImage(
    target,
    {
      // mov edi, 42; mov eax, SYS_exit; syscall
      code: Uint8Array.of(0xbf, 42, 0, 0, 0, 0xb8, 60, 0, 0, 0, 0x0f, 0x05),
      entryOffset: 0,
      maxByteLength: 1 << 20,
    },
    "tint.x64",
    [],
  );
  assert.ok(image.ok, JSON.stringify(!image.ok && image.error));
  assert.equal(new DataView(image.value.buffer).getUint16(18, true), 62);
});
