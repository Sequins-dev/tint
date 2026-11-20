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

function sourcePosition(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const provider = source.value;
  return (offset: number) => {
    const position = provider.positionAt(offset);
    return position.ok ? position.value : undefined;
  };
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
        sourcePosition: sourcePosition(text),
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

test("x86-64 hosted entry and managed frames have indexed unwind ranges", () => {
  const built = build(
    `function nested(x: number): number { return x + 23; }
     export function run(): number { return nested(19); }`,
    {},
    { optimization: "none" },
  );
  assert.ok(built.ok, JSON.stringify(built));
  const image = Buffer.from(built.value);
  const programHeaders = Number(image.readBigUInt64LE(32));
  const count = image.readUInt16LE(56);
  const size = image.readUInt16LE(54);
  const header = Array.from(
    { length: count },
    (_, i) => programHeaders + i * size,
  ).find((offset) => image.readUInt32LE(offset) === 0x6474e550);
  assert.ok(header !== undefined, "PT_GNU_EH_FRAME");
  const contents = Number(image.readBigUInt64LE(header + 8));
  assert.ok(
    image.readUInt32LE(contents + 8) >= 4,
    "managed functions, main and _start",
  );
});

test("x86-64 debug images describe TypeScript source lines and stack parameters", () => {
  const built = build(
    `function inspect(value: number): number {
       return value + 23;
     }
     export function run(): number { return inspect(19); }`,
    {},
    { optimization: "none", debugSymbols: true },
  );
  assert.ok(built.ok, JSON.stringify(built));
  const bytes = Buffer.from(built.value);
  for (const text of [".debug_line\0", ".debug_info\0", "smoke\0", "value\0"])
    assert.ok(bytes.includes(text), text);
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
      { runtimeEntry: "initializeCopyingRuntime" },
    ),
    {
      ok: false,
      error: {
        stage: "target",
        message:
          "linux-x86_64: unsupported operation initializeCopyingRuntime (requires slice 7)",
      },
    },
  );
});

const runner = process.env.TINT_X64_HOSTED_RUNNER;
const native = {
  skip:
    runner === undefined && "set TINT_X64_HOSTED_RUNNER for x86-64 execution",
};

test("x86-64 forced far image resolves calls, branches, permanent data and imports", () => {
  const built = build(
    `import { argumentCount } from "process";
     function answer(text: string): number {
       if (argumentCount() > 0 && text === "far") return 42;
       return 1;
     }
     export function run(): number { return answer("far"); }`,
    {
      process: intrinsic("process", { argumentCount: "argument-count" }),
    },
    { forceFarReach: true, managedBytes: 4294966272, optimization: "none" },
  );
  assert.ok(built.ok, JSON.stringify(built));
  if (runner !== undefined) assert.equal(run(built.value).status, 42);
});

test("x86-64 shared atomics preserve width, observed words and adjacent bytes", () => {
  const built = build(
    `import { mapMemory, unmapMemory, readMemoryWord, writeMemoryWord,
       compareExchangeMemoryWord, fetchAddMemoryWord, loadAcquireMemoryWord,
       storeReleaseMemoryWord, compareExchangeMemoryUnsigned } from "memory";
     import { readSharedUnsigned, writeSharedUnsigned, readSharedWord64,
       writeSharedWord64, compareExchangeSharedWord64 } from "shared";
     export function run(): number {
       const base = mapMemory(4096);
       if (base <= 0) return 1;
       if (writeMemoryWord(base, 16, 0, 0x11223344) !== 0 ||
           compareExchangeMemoryUnsigned(base, 16, 1, 1, 0x35, 0xff) !== 0x33 ||
           compareExchangeMemoryUnsigned(base, 16, 1, 1, 0x33, 0xff) !== 0x33 ||
           writeSharedUnsigned(base, 16, 2, 2, 0xabcd, 1) !== 0 ||
           readSharedUnsigned(base, 16, 0, 4, 1) !== 0xabcdff44) return 2;
       if (readSharedUnsigned(base, 16, 1, 2, 1) !== -1 ||
           readSharedUnsigned(base, 16, 15, 4, 1) !== -1 ||
           compareExchangeMemoryUnsigned(base, 16, 0, 1, 256, 0) !== -1) return 3;
       if (storeReleaseMemoryWord(base, 16, 8, 5) !== 0 ||
           compareExchangeMemoryWord(base, 16, 8, 4, 7) !== 5 ||
           compareExchangeMemoryWord(base, 16, 8, 5, 9) !== 5 ||
           fetchAddMemoryWord(base, 16, 8, -2) !== 9 ||
           loadAcquireMemoryWord(base, 16, 8) !== 7 ||
           readMemoryWord(base, 16, 0) !== 0xabcdff44) return 4;
       const scratch = new Uint32Array(2);
       if (writeSharedWord64(base, 16, 0, 1, 0xabcdef01, 0x87654321) !== 0 ||
           readSharedWord64(base, 16, 0, 1, scratch) !== 0 ||
           scratch[0] !== 0xabcdef01 || scratch[1] !== 0x87654321) return 5;
       if (compareExchangeSharedWord64(base, 16, 0, 0xabcdef01, 0x87654321,
           3, 4, scratch) !== 0 || scratch[0] !== 0xabcdef01 ||
           scratch[1] !== 0x87654321 ||
           readSharedWord64(base, 16, 0, 0, scratch) !== 0 ||
           scratch[0] !== 3 || scratch[1] !== 4) return 6;
       if (readSharedWord64(base, 16, 0, 1, new Uint32Array(1)) !== -1 ||
           writeSharedWord64(base, 16, 0, 2, 0, 0) !== -1) return 7;
       return unmapMemory(base, 4096) === 0 ? 42 : 8;
     }`,
    {
      memory: intrinsic("memory", {
        mapMemory: "memory-map",
        unmapMemory: "memory-unmap",
        readMemoryWord: "memory-read-word",
        writeMemoryWord: "memory-write-word",
        compareExchangeMemoryWord: "memory-compare-exchange-word",
        fetchAddMemoryWord: "memory-fetch-add-word",
        loadAcquireMemoryWord: "memory-load-acquire-word",
        storeReleaseMemoryWord: "memory-store-release-word",
        compareExchangeMemoryUnsigned: "shared-compare-exchange-unsigned",
      }),
      shared: intrinsic("shared-atomics", {
        readSharedUnsigned: "shared-read-unsigned",
        writeSharedUnsigned: "shared-write-unsigned",
        readSharedWord64: "shared-read-word64",
        writeSharedWord64: "shared-write-word64",
        compareExchangeSharedWord64: "shared-compare-exchange-word64",
      }),
    },
  );
  assert.ok(built.ok, JSON.stringify(built));
  if (runner !== undefined) assert.equal(run(built.value).status, 42);
});

test("x86-64 collector workers contend on shared words and wake futex waiters", () => {
  const built = build(
    `import { mapMemory, unmapMemory, readMemoryWord, writeMemoryWord,
       fetchAddMemoryWord, loadAcquireMemoryWord, storeReleaseMemoryWord,
       collectorWorkerEntry, permanentFunctionAddress, startNativeThread,
       joinNativeThread, parkNativeWord, wakeNativeWord, spinPause } from "memory";
     const worker = (mailbox: number): number => {
       for (let i = 0; i < 10000; i++) fetchAddMemoryWord(mailbox, 32, 8, 1);
       fetchAddMemoryWord(mailbox, 32, 16, 1);
       while (loadAcquireMemoryWord(mailbox, 32, 24) === 0) {
         const status = parkNativeWord(mailbox + 24, 0, 0);
         if (status !== 0 && status !== -11 && status !== -4) return 3;
       }
       return 7;
     };
     export function run(): number {
       const mailbox = mapMemory(4096);
       if (mailbox <= 0) return 1;
       if (parkNativeWord(mailbox + 24, 1, 1000000) !== -11 ||
           parkNativeWord(mailbox + 24, 0, 1000000) !== -110 ||
           wakeNativeWord(mailbox + 24, 0) !== 0 ||
           parkNativeWord(mailbox + 25, 0, 1) !== -1) return 2;
       if (writeMemoryWord(mailbox, 32, 0, permanentFunctionAddress(worker)) !== 0) return 3;
       const entry = collectorWorkerEntry();
       const threads = new Float64Array(4);
       for (let i = 0; i < threads.length; i++) {
         const handle = startNativeThread(entry, mailbox);
         if (handle <= 0) return 4;
         threads[i] = handle;
       }
       while (loadAcquireMemoryWord(mailbox, 32, 16) !== 4) spinPause();
       let woke = 0;
       while (woke === 0) {
         woke = wakeNativeWord(mailbox + 24, 0);
         spinPause();
       }
       if (woke !== 1) return 5;
       if (storeReleaseMemoryWord(mailbox, 32, 24, 1) !== 0 ||
           wakeNativeWord(mailbox + 24, 1) < 0) return 5;
       for (let i = 0; i < threads.length; i++)
         if (joinNativeThread(threads[i] ?? 0) !== 7) return 6;
       if (readMemoryWord(mailbox, 32, 8) !== 40000) return 7;
       return unmapMemory(mailbox, 4096) === 0 ? 42 : 8;
     }`,
    {
      memory: intrinsic("memory", {
        mapMemory: "memory-map",
        unmapMemory: "memory-unmap",
        readMemoryWord: "memory-read-word",
        writeMemoryWord: "memory-write-word",
        fetchAddMemoryWord: "memory-fetch-add-word",
        loadAcquireMemoryWord: "memory-load-acquire-word",
        storeReleaseMemoryWord: "memory-store-release-word",
        collectorWorkerEntry: "collector-worker-entry",
        permanentFunctionAddress: "permanent-function-address",
        startNativeThread: "thread-start",
        joinNativeThread: "thread-join",
        parkNativeWord: "word-park",
        wakeNativeWord: "word-wake",
        spinPause: "cpu-pause",
      }),
    },
  );
  assert.ok(built.ok, JSON.stringify(built));
  if (runner !== undefined) assert.equal(run(built.value).status, 42);
});

test("x86-64 hosted threads have independent contexts and process arguments", () => {
  const built = build(
    `import { mapMemory, unmapMemory, readMemoryWord, writeMemoryWord,
       startNativeThread, joinNativeThread, hostedThreadEntry,
       currentContextDomain } from "memory";
     import { argc } from "host";
     export function run(argument: number): number {
       if (argument === 1) throw "worker failure";
       const domain = currentContextDomain();
       if (domain <= 0) return 2;
       if (argument !== 0) {
         if (argc() !== 0) return 3;
         const retained = new Uint8Array(64);
         retained[0] = 7;
         if (writeMemoryWord(argument, 8, 0, domain) !== 0) return 4;
         return retained[0] ?? 0;
       }
       if (argc() < 1) return 5;
       const mailbox = mapMemory(4096);
       if (mailbox <= 0) return 6;
       const entry = hostedThreadEntry();
       const first = startNativeThread(entry, mailbox);
       const second = startNativeThread(entry, mailbox + 8);
       if (first <= 0 || second <= 0) return 7;
       if (joinNativeThread(first) !== 7 || joinNativeThread(second) !== 7) return 8;
       const a = readMemoryWord(mailbox, 16, 0);
       const b = readMemoryWord(mailbox, 16, 8);
       if (a <= 0 || b <= 0 || a === b || a === domain || b === domain) return 9;
       const failed = startNativeThread(entry, 1);
       if (failed <= 0 || joinNativeThread(failed) !== 70) return 10;
       return unmapMemory(mailbox, 4096) === 0 ? 42 : 11;
     }`,
    {
      memory: intrinsic("memory", {
        mapMemory: "memory-map",
        unmapMemory: "memory-unmap",
        readMemoryWord: "memory-read-word",
        writeMemoryWord: "memory-write-word",
        startNativeThread: "thread-start",
        joinNativeThread: "thread-join",
        hostedThreadEntry: "hosted-thread-entry",
        currentContextDomain: "context-domain",
      }),
      host: {
        text: "export function argc(): number { return 0; }",
        bindings: { argc: "argument-count" },
      },
    },
    { threaded: true },
  );
  assert.ok(built.ok, JSON.stringify(built));
  if (runner !== undefined) assert.equal(run(built.value).status, 42);
});

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

test(
  "x86-64 typed arrays share backing storage across nested views",
  native,
  () => {
    const built = build(
      `
    export function run(): number {
      const bytes = new Uint8Array(3);
      const halves = new Uint16Array(3);
      const words = new Uint32Array(6);
      const doubles = new Float64Array(3);
      bytes[0] = -1;
      halves[0] = 65537;
      words[2] = -1;
      doubles[0] = -0;
      doubles[1] = 0 / 0;
      doubles[2] = 1.125;
      if ((bytes[0] ?? 0) !== 255 || (halves[0] ?? 0) !== 1 ||
          (words[2] ?? 0) !== 4294967295 || doubles.byteLength !== 24 ||
          1 / (doubles[0] ?? 1) !== -1 / 0 || (doubles[1] ?? 1) === 1 ||
          (doubles[2] ?? 0) !== 1.125) return 1;
      const view = words.subarray(1, 5);
      const nested = view.subarray(1, 3);
      if (nested.byteOffset !== 8 || nested.byteLength !== 8 ||
          nested.buffer !== words.buffer ||
          (nested[0] ?? 0) !== 4294967295 ||
          (nested[1.5] ?? 47) !== 47 || (nested[-1] ?? 48) !== 48) return 2;
      nested[0] = 19;
      nested[1] = 42;
      if ((words[2] ?? 0) !== 19 || (view[1] ?? 0) !== 19) return 3;
      return words[3] ?? 0;
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 permanent UTF-16 strings support code-unit access and tagged throws",
  native,
  () => {
    const built = build(
      `
    function read(text: string): number {
      if (text.length !== 4 || text.charCodeAt(0) !== 65 ||
          text.charCodeAt(1) !== 55357 || text.charCodeAt(2) !== 56832 ||
          text.charCodeAt(3) !== 55296 || text.charCodeAt(-0.75) !== 65 ||
          text.charCodeAt(0 / 0) !== 65) return 1;
      const absent = text.charCodeAt(1 / 0);
      return absent !== absent ? 42 : 2;
    }
    function raise(): number { throw "A😀\\ud800"; }
    function relay(): number { return raise(); }
    export function run(): number {
      const status = read("A😀\\ud800");
      if (status !== 42) return status;
      try { return relay(); }
      catch { return read("A😀\\ud800"); }
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 string leaves preserve optional equality and prefix bounds",
  native,
  () => {
    const built = build(
      `
    function maybe(available: boolean): string | undefined {
      return available ? "Tint" : undefined;
    }
    function equal(left: string | undefined, right: string | undefined): boolean {
      return left === right;
    }
    function prefix(text: string, pattern: string, position: number): boolean {
      return text.startsWith(pattern, position);
    }
    export function run(): number {
      const text = "A😀B";
      if (!equal(maybe(true), "Tint") || equal(maybe(true), "Ting") ||
          !equal(maybe(false), undefined) || equal(maybe(false), "Tint")) return 1;
      if (!prefix(text, "A", -2) || !prefix(text, "A", 0 / 0) ||
          !prefix(text, "😀", 1.75) || prefix(text, "B", 1) ||
          !prefix(text, "", 1 / 0) || prefix(text, "B", 1 / 0)) return 2;
      return 42;
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 record fields preserve nullable links and optional scalars",
  native,
  () => {
    const built = build(
      `
    interface Link {
      value: number;
      next: Link | undefined;
      enabled: boolean | undefined;
      measure: number | undefined;
    }
    function value(link: Link | undefined): number {
      return link ? link.value : 0;
    }
    function same(left: Link, right: Link): boolean {
      return left.enabled === right.enabled && left.measure === right.measure;
    }
    export function run(): number {
      const tail: Link = { value: 13, next: undefined, enabled: false, measure: -0 };
      const head: Link = { value: 0, next: tail, enabled: undefined, measure: undefined };
      if (head.next !== tail || value(head.next) !== 13 || same(head, tail)) return 1;
      if (!same(head, head) || (tail.enabled ?? true) !== false) return 2;
      head.enabled = false;
      head.measure = 0;
      if (!same(head, tail) || 1 / (tail.measure ?? 1) !== -1 / 0) return 3;
      head.measure = 0 / 0;
      if (same(head, head) || (head.measure ?? 1) === 1) return 4;
      head.next = undefined;
      if (head.next || value(head.next) !== 0) return 5;
      tail.value = 42;
      head.next = tail;
      return value(head.next);
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 C memory adopts and retargets borrowed array storage",
  native,
  () => {
    const built = build(
      `import { adoptExternal, externalAddress, retargetExternal, stableBytes } from "ffi";
    export function run(): number {
      const empty = new Uint8Array(0);
      if (externalAddress(empty) !== -1 || stableBytes(empty)) return 11;
      const borrowed = adoptExternal(empty, 4096, 3);
      if (externalAddress(borrowed) !== 4096 || !stableBytes(borrowed) ||
          borrowed.length !== 3) return 12;
      retargetExternal(borrowed, 8192);
      if (externalAddress(borrowed) !== 8192 || borrowed.length !== 3) return 13;
      return 42;
    }`,
      {
        ffi: {
          text: `
        export function adoptExternal(empty: Uint8Array, address: number, length: number): Uint8Array { throw "HOST_UNAVAILABLE"; }
        export function externalAddress(view: Uint8Array): number { throw "HOST_UNAVAILABLE"; }
        export function retargetExternal(view: Uint8Array, address: number): void { throw "HOST_UNAVAILABLE"; }
        export function stableBytes(view: Uint8Array): boolean { throw "HOST_UNAVAILABLE"; }`,
          bindings: {},
        },
      },
      {
        foreignMemoryBindings: [
          { module: "ffi", name: "adoptExternal", operation: "adopt" },
          { module: "ffi", name: "externalAddress", operation: "address" },
          { module: "ffi", name: "retargetExternal", operation: "retarget" },
          { module: "ffi", name: "stableBytes", operation: "stable" },
        ],
      },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 escaping closures share writes across indirect calls",
  native,
  () => {
    const built = build(
      `
    interface Counter {
      add: (n: number) => number;
      read: () => number;
    }
    function counter(start: number): Counter {
      let value = start;
      function bump(n: number): number { value += n; return value; }
      function add(n: number): number { return bump(n); }
      return { add, read: (): number => value };
    }
    export function run(): number {
      const first = counter(10);
      const other = counter(8);
      if (first.add(20) !== 30) return 1;
      if (other.add(3) !== 11) return 2;
      if (first.read() !== 30) return 3;
      return first.add(12);
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 indirect calls forward stack arguments and propagate throws",
  native,
  () => {
    const built = build(
      `
    type F = (a: boolean, b: boolean, c: boolean, d: number, e: number,
      f: number, g: number, h: number, i: number, j: number, k: number,
      l: number) => number;
    function choose(base: number): F {
      return (a, b, c, d, e, f, g, h, i, j, k, l): number => {
        if (!a || b || !c) throw "bad flags";
        return base + d + e + f + g + h + i + j + k + l;
      };
    }
    export function run(): number {
      const fn = choose(6);
      try {
        fn(false, false, true, 0, 1, 2, 3, 4, 5, 6, 7, 8);
        return 2;
      } catch (e) {
        return fn(true, false, true, 0, 1, 2, 3, 4, 5, 6, 7, 8);
      }
    }
    `,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 allocates UTF-16 strings with JavaScript slice bounds",
  native,
  () => {
    const built = build(
      `function units(a: number, b: number, c: number): string {
      return String.fromCharCode(a, b, c);
    }
    function tail(text: string, start: number, end?: number): string {
      return text.slice(start, end);
    }
    export function run(): number {
      const left = units(65601, -1, 55296);
      const right = units(0 / 0, 66.9, 1 / 0);
      const text = left + right;
      if (text.length !== 6 || text.charCodeAt(1) !== 65535 ||
          text.charCodeAt(2) !== 55296 || text.charCodeAt(4) !== 66) return 1;
      if (tail(text, -2.8) !== "B\\0" ||
          tail(text, -0.75, 1) !== "A" ||
          tail(text, -1 / 0, -5) !== "A" ||
          tail(text, 0 / 0, 1 / 0) !== text ||
          tail(text, 1 / 0, 0) !== "") return 2;
      return 42;
    }`,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);

test(
  "x86-64 hosted general completion preserves tags and JavaScript equality",
  native,
  () => {
    const built = build(
      `function same(a: unknown, b: unknown): boolean { return a === b; }
    function kind(value: unknown): string { return typeof value; }
    export function run(): unknown {
      const joined = "native" + String.fromCharCode(33);
      const object = { value: 42 };
      const fn = (): number => 42;
      if (!same(joined, "native!") || !same(0, -0) || same(0 / 0, 0 / 0) ||
          same(undefined, null) || same(false, 0) || !same(object, object) ||
          same(object, { value: 42 })) return 2;
      if (kind(fn) !== "function" || kind(object) !== "object" ||
          kind(null) !== "object" || kind(joined) !== "string") return 3;
      try { throw new RangeError("range"); }
      catch (caught) {
        if (!(caught instanceof RangeError) || !(caught instanceof Error) ||
            caught instanceof TypeError || caught.message !== "range") return 4;
      }
      return 42;
    }`,
      {},
      { optimization: "none" },
    );
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(run(built.value).status, 42);
  },
);
