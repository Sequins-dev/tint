import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildMacOSProgram, type BuildRequest } from "@tint/compiler/build";
import { linuxX86_64Target } from "@tint/platform/target";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";

type Operation = BuildRequest["hostBindings"][number]["operation"];
interface HostModule {
  readonly text: string;
  readonly bindings: Readonly<Record<string, Operation>>;
}

function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

function intrinsic(name: string, bindings: HostModule["bindings"]): HostModule {
  return {
    text: readFileSync(
      new URL(
        "../packages/native-runtime/src/intrinsics/" + name + ".ts",
        import.meta.url,
      ),
      "utf8",
    ),
    bindings,
  };
}

function build(
  text: string,
  host: Readonly<Record<string, HostModule>> = {},
  options: Partial<BuildRequest> = {},
) {
  const dependencies = Object.entries(host);
  return buildMacOSProgram({
    target: linuxX86_64Target,
    modules: [
      {
        id: "smoke",
        module: parse(text),
        dependencies: new Map(dependencies.map(([name]) => [name, name])),
      },
      ...dependencies.map(([id, source]) => ({
        id,
        module: parse(source.text),
        dependencies: new Map(),
      })),
    ],
    entry: "smoke",
    start: "run",
    runtimes: dependencies.map(([module]) => ({ module, namespace: module })),
    hostBindings: dependencies.flatMap(([module, { bindings }]) =>
      Object.entries(bindings).map(([name, operation]) => ({
        module,
        name,
        operation,
      })),
    ),
    allocatorModule: "allocator",
    runtimeModule: "runtime",
    memoryModule: "memory",
    identifier: "tint.x64.hosted",
    managedBytes: 4096,
    controlBytes: 4096,
    allocationCapacity: 16,
    rootCapacity: 16,
    stackBytes: 1048576,
    report: () => {},
    ...options,
  });
}

test("x86-64 hosted entry links the glibc 2.34 process entry", () => {
  const built = build("export function run(): number { return 42; }");
  assert.ok(built.ok, JSON.stringify(built));
  const image = Buffer.from(built.value);
  assert.equal(image.readUInt16LE(18), 62); // EM_X86_64
  const shoff = Number(image.readBigUInt64LE(40));
  const shentsize = image.readUInt16LE(58);
  const shnum = image.readUInt16LE(60);
  const section = (index: number) => shoff + index * shentsize;
  const ofType = (type: number) =>
    Array.from({ length: shnum }, (_, i) => section(i)).find(
      (offset) => image.readUInt32LE(offset + 4) === type,
    );
  const fileOffset = (sh: number) => Number(image.readBigUInt64LE(sh + 24));
  const stringAt = (offset: number) =>
    image.toString("utf8", offset, image.indexOf(0, offset));
  const verneed = ofType(0x6ffffffe);
  const versym = ofType(0x6fffffff);
  assert.ok(verneed !== undefined && versym !== undefined);

  const dynsym = section(image.readUInt32LE(versym + 40));
  const dynstr = fileOffset(section(image.readUInt32LE(verneed + 40)));
  const requirement = fileOffset(verneed);
  assert.equal(image.readUInt16LE(requirement), 1);
  assert.equal(image.readUInt16LE(requirement + 2), 1);
  assert.equal(
    stringAt(dynstr + image.readUInt32LE(requirement + 4)),
    "libc.so.6",
  );
  const version = requirement + image.readUInt32LE(requirement + 8);
  assert.equal(
    stringAt(dynstr + image.readUInt32LE(version + 8)),
    "GLIBC_2.34",
  );
  const index = image.readUInt16LE(version + 6);
  const symbolCount = Number(image.readBigUInt64LE(versym + 32)) / 2;
  const symbol = Array.from({ length: symbolCount }, (_, i) => i).find(
    (i) => image.readUInt16LE(fileOffset(versym) + i * 2) === index,
  );
  assert.ok(symbol !== undefined);
  assert.equal(
    stringAt(dynstr + image.readUInt32LE(fileOffset(dynsym) + symbol * 24)),
    "__libc_start_main",
  );
});

test("x86-64 hosted compilation pinpoints deferred runtime operations", () => {
  const built = build(
    `
    import { collect } from "host";
    export function run(): number { collect(); return 42; }
  `,
    {
      host: {
        text: "export function collect(): void {}",
        bindings: { collect: "collect-garbage" },
      },
    },
  );
  assert.deepEqual(built, {
    ok: false,
    error: {
      stage: "emit",
      message:
        "linux-x86_64: unsupported host operation collect-garbage (requires slice 7)",
    },
  });
  assert.deepEqual(
    build(
      "export function run(): number { return 42; }",
      {},
      { runtimeEntry: "initializeGenerationalRuntime" },
    ),
    {
      ok: false,
      error: {
        stage: "target",
        message:
          "linux-x86_64: unsupported operation initializeGenerationalRuntime (requires slice 7)",
      },
    },
  );
});

const runner = process.env.TINT_X64_HOSTED_RUNNER;
const native = {
  skip:
    runner === undefined && "set TINT_X64_HOSTED_RUNNER for x86-64 execution",
};

test(
  "x86-64 hosted stack maps locate and update actual suspended roots",
  native,
  () => {
    const built = build(
      `
    import { rootHead, readWord, writeWord } from "memory";

    function word(address: number): number {
      return readWord(address, 8, 0);
    }
    function mapFor(registry: number, pc: number): number {
      if (word(registry) !== 1) return 0;
      const start = word(registry + 32);
      const length = word(registry + 40);
      const table = word(registry + 48);
      if (pc < start || pc >= start + length ||
          word(table) !== 1346456915 || word(table + 8) !== 3) return 0;
      const count = word(table + 16);
      for (let i = 0; i < count; i++) {
        const entry = table + 24 + i * 16;
        if (word(entry) === pc - start)
          return table + word(entry + 8) * 8;
      }
      return 0;
    }
    function scan(): number {
      // This fixture relocates one byte array to an already allocated copy.
      // The hook walks the two suspended callers using their real frame chain.
      const registry = rootHead();
      if (registry === 0 || word(registry + 24) !== 0) return 1;
      const start = word(registry + 16);
      const relay = word(start);
      const outer = word(relay);
      const relayPc = word(start + 8);
      const outerPc = word(relay + 8);
      const relayMap = mapFor(registry, relayPc);
      const outerMap = mapFor(registry, outerPc);
      if (relayMap === 0 || outerMap === 0) return 2;
      if (mapFor(registry, outerPc + 1) !== 0) return 8;
      if (relay - word(relayMap) !== start + 16 ||
          outer - word(outerMap) !== relay + 16) return 9;
      let entry = word(outer);
      for (let i = 0; i < 4 && word(entry) !== 0; i++) entry = word(entry);
      if (word(entry) !== 0) return 10;
      if (word(relayMap + 8) !== 1 || word(outerMap + 8) !== 3) return 3;
      const relayRoot = relay - word(relayMap) + word(relayMap + 16);
      const from = word(relayRoot);
      let to = 0;
      for (let i = 0; i < 3; i++) {
        const slot = outer - word(outerMap) + word(outerMap + 16 + i * 8);
        const object = word(slot);
        if (object !== from) to = object;
      }
      if (to === 0 || word(to) !== 2) return 4;
      if (writeWord(relayRoot, 8, 0, to) !== 0) return 5;
      for (let i = 0; i < 3; i++) {
        const slot = outer - word(outerMap) + word(outerMap + 16 + i * 8);
        if (word(slot) === from && writeWord(slot, 8, 0, to) !== 0) return 6;
      }
      return 0;
    }
    function relay(before: Uint8Array): number {
      const status = scan();
      if (status !== 0) return status + 100;
      return before[0] ?? 0;
    }
    export function run(): number {
      const before = new Uint8Array(1), after = new Uint8Array(1);
      before[0] = 19;
      after[0] = 42;
      const status = relay(before);
      if (status !== 42) return status;
      return (before[0] ?? 0) === (after[0] ?? 0) ? 42 : 7;
    }
    `,
      {
        memory: {
          text: `
          export function rootHead(): number { return 0; }
          export function readWord(base: number, length: number, offset: number): number { return -1; }
          export function writeWord(base: number, length: number, offset: number, value: number): number { return -1; }
        `,
          bindings: {
            rootHead: "root-head",
            readWord: "memory-read-word",
            writeWord: "memory-write-word",
          },
        },
      },
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

function run(image: Uint8Array, args: (name: string) => string[] = () => []) {
  const directory = mkdtempSync(join(tmpdir(), "tint-x64-hosted-"));
  try {
    const path = join(directory, "cli");
    writeFileSync(path, image, { mode: 0o755 });
    const [result] = runNativeBatch(
      [
        {
          artifact: nativeArtifact(linuxX86_64Target.name, path),
          args: args(directory.slice(directory.lastIndexOf("/") + 1)),
        },
      ],
      { ...process.env, TZ: "UTC", TINT_NATIVE_RUNNER: runner },
    );
    assert.equal(result?.kind, "exited", JSON.stringify(result));
    console.log(JSON.stringify(result));
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "x86-64 hosted CLI preserves argv, environment, file I/O, clocks, entropy and status",
  native,
  () => {
    const built = build(
      `
    import { argumentCount, argumentByteLength, copyArgument, copyEnvironment, targetArchitecture, targetOperatingSystem } from "process";
    import { openExclusive, openRead, read, write, close, unlink, chmod, rename } from "fs";
    import { monotonicMilliseconds, wallClockMilliseconds } from "clock";
    import { randomUint32 } from "random";
    import { processId } from "diagnostics";
    import { memoryPageBytes } from "memory";

    function initialize(): number {
      const banner = new Uint8Array(2);
      banner[0] = 73;
      banner[1] = 10;
      return write(1, banner);
    }
    const initialized: number = initialize();
    export function run(): number {
      if (argumentCount() !== 4 || argumentByteLength(-1) !== -1 ||
          argumentByteLength(4) !== -1 || argumentByteLength(3) !== 3 ||
          argumentByteLength(1.5) !== -1) return 11;
      const bytes = new Uint8Array(3);
      if (copyArgument(3, bytes) !== 3 || bytes[0] !== 72 ||
          bytes[1] !== 105 || bytes[2] !== 10) return 12;
      const path = new Uint8Array(argumentByteLength(1) + 1);
      const nextPath = new Uint8Array(argumentByteLength(2) + 1);
      if (copyArgument(1, path) !== path.length - 1 ||
          copyArgument(2, nextPath) !== nextPath.length - 1) return 13;
      const key = new Uint8Array(3);
      key[0] = 84;
      key[1] = 90;
      if (copyEnvironment(key, bytes) !== 3 || bytes[0] !== 85 ||
          bytes[1] !== 84 || bytes[2] !== 67) return 14;
      const shortBuffer = new Uint8Array(2);
      if (copyArgument(3, shortBuffer) !== -1 || copyEnvironment(key, shortBuffer) !== -1 ||
          shortBuffer[0] !== 0 || shortBuffer[1] !== 0) return 15;
      if (copyArgument(3, bytes) !== 3 || write(1, bytes) !== 3 ||
          write(2, bytes) !== 3 || write(-1, bytes) !== -9) return 16;
      const fd = openExclusive(path, 384);
      if (fd < 0 || chmod(fd, 384) !== 0 || write(fd, bytes) !== 3 || close(fd) !== 0) return 17;
      if (openExclusive(path, 384) !== -17 || rename(path, nextPath) !== 0) return 18;
      const input = openRead(nextPath);
      const received = new Uint8Array(3);
      if (input < 0 || read(input, received) !== 3 ||
          close(input) !== 0 || unlink(nextPath) !== 0) return 19;
      if (received[0] !== 72 || received[1] !== 105 || received[2] !== 10 ||
          openRead(path) !== -2 || openRead(nextPath) !== -2) return 20;
      const before = monotonicMilliseconds();
      const sample = randomUint32();
      if (before <= 0 || monotonicMilliseconds() < before || wallClockMilliseconds() < 1700000000000 ||
          sample < 0 || sample > 4294967295 || sample % 1 !== 0) return 21;
      if (targetArchitecture() !== 2 || targetOperatingSystem() !== 2 ||
          memoryPageBytes() !== 4096 || processId() <= 0)
        return 22;
      return 42;
    }
  `,
      {
        process: intrinsic("process", {
          argumentCount: "argument-count",
          argumentByteLength: "argument-length",
          copyArgument: "argument-copy",
          copyEnvironment: "environment-copy",
          targetArchitecture: "target-architecture",
          targetOperatingSystem: "target-os",
        }),
        fs: intrinsic("fs", {
          openExclusive: "open-exclusive",
          openRead: "open-read",
          read: "read",
          write: "write",
          close: "close",
          unlink: "unlink",
          chmod: "chmod",
          rename: "rename",
        }),
        clock: intrinsic("clock", {
          monotonicMilliseconds: "monotonic-time",
          wallClockMilliseconds: "wall-clock-time",
        }),
        random: intrinsic("random", { randomUint32: "random-word" }),
        diagnostics: intrinsic("diagnostics", { processId: "process-id" }),
        memory: intrinsic("memory", { memoryPageBytes: "memory-page-bytes" }),
      },
    );
    assert.ok(built.ok, JSON.stringify(built));
    const result = run(built.value, (name) => [
      "/tmp/" + name + " ' file",
      "/tmp/" + name + " ' renamed",
      "Hi\n",
    ]);
    assert.equal(result.status, 42);
    assert.equal(result.stdout, "I\nHi\n");
    assert.equal(result.stderr, "Hi\n");
  },
);

test(
  "x86-64 managed stack exhaustion unwinds through a completion",
  native,
  () => {
    const built = build(`
    function recurse(depth: number): number {
      if (depth === 0) return 0;
      return recurse(depth - 1) + 1;
    }
    export function run(): number {
      try { return recurse(1000000); } catch { return recurse(42); }
    }
  `);
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);
