import { buildAArch64Executable } from "./aarch64-executable.ts";
/** Build-only direct-native pthread contention images. This tool never launches
 * them, invokes C/assembler/linker tools, or installs default host permissions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { contentionCode } from "./native-contention-fixture.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  saveWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("contention fixture requires TINT_BUILD_ONLY=1");
const output = resolve(
  process.argv[2] ?? ".tint-bootstrap/native-contention-artifacts-v2",
);
mkdirSync(output);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const snapshot = workspaceSources(),
  sourceSnapshot = workspaceSourceIdentity(snapshot);
saveWorkspaceSourceSnapshot(join(output, "workspace.sources.json"), snapshot);
const tools = [
  "tools/native-contention-fixture.ts",
  "tools/native-contention-leaf-audit.ts",
  "tools/native-contention-machine.ts",
  "tools/native-contention.test.ts",
  "tools/build-native-contention-fixture.ts",
];
mkdirSync(join(output, "tools"));
const fixtureSources = tools.map((path) => {
  copyFileSync(path, join(output, path));
  return { path, sha256: sha(readFileSync(path)) };
});
const sdkRoot = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
const sdkSettings = JSON.parse(
  readFileSync(join(sdkRoot, "SDKSettings.json"), "utf8"),
);
const pthread = readFileSync(
    join(sdkRoot, "usr/include/pthread/pthread.h"),
    "utf8",
  ),
  pthreadTypes = readFileSync(
    join(sdkRoot, "usr/include/sys/_pthread/_pthread_types.h"),
    "utf8",
  );
assert.match(pthread, /int pthread_create\(pthread_t/);
assert.match(pthread, /void \* _Nullable \(\* _Nonnull\)\(void \* _Nullable\)/);
assert.match(pthread, /int pthread_join\(pthread_t/);
assert.match(
  pthreadTypes,
  /typedef struct _opaque_pthread_t \*__darwin_pthread_t;/,
);
const sdkFiles = [
  "SDKSettings.json",
  "usr/include/pthread/pthread.h",
  "usr/include/sys/_pthread/_pthread_types.h",
].map((path) => ({ path, sha256: sha(readFileSync(join(sdkRoot, path))) }));
const [major, minor, patch] = String(sdkSettings.Version)
  .split(".")
  .map(Number);
assert.ok(major !== undefined && minor !== undefined);
const artifacts = [];
for (const width of [1, 2, 4] as const) {
  const generated = contentionCode(width, 1000),
    path = join(output, "contention-u" + width * 8);
  const emitter = readFileSync("tools/native-contention-fixture.ts", "utf8");
  const line = (needle: string) =>
    emitter.slice(0, emitter.indexOf(needle)).split("\n").length;
  const functions = [
    { name: "main", offset: 0, byteLength: generated.workerOffset },
    {
      name: "contention_worker",
      offset: generated.workerOffset,
      byteLength: generated.casLeafOffset - generated.workerOffset,
    },
    {
      name: "shared_unsigned_cas",
      offset: generated.casLeafOffset,
      byteLength: generated.casLeafByteLength,
    },
  ];
  const built = buildAArch64Executable({
    code: generated.code,
    entryOffset: 0,
    identifier: "tint.native-contention.u" + width * 8,
    minimumOS: { major: 13, minor: 0, patch: 0 },
    sdk: { major, minor, patch: patch ?? 0 },
    allowDebugger: true,
    allowJit: false,
    imports: generated.imports,
    addressFixups: generated.addressFixups,
    symbols: functions.map((fn) => ({
      name: "_" + fn.name,
      offset: fn.offset,
    })),
    debug: {
      directory: resolve("."),
      functions,
      lines: functions.map((fn, index) => ({
        offset: fn.offset,
        byteLength: fn.byteLength,
        file:
          index === 2
            ? "packages/codegen/src/aarch64/scalar/shared-memory.ts"
            : "tools/native-contention-fixture.ts",
        line:
          index === 0
            ? line('label("main")')
            : index === 1
              ? line('label("worker")')
              : 20,
        column: 1,
      })),
    },
    maxByteLength: 1024 * 1024,
  });
  assert.ok(built.ok, JSON.stringify(built));
  assert.deepEqual(
    workspaceSourceIdentity(workspaceSources()),
    sourceSnapshot,
    "portable source changed during build",
  );
  for (const item of fixtureSources)
    assert.equal(
      sha(readFileSync(item.path)),
      item.sha256,
      "fixture source changed during build",
    );
  writeFileSync(path, built.value.bytes, { flag: "wx", mode: 0o755 });
  const metadata = {
    binary: path,
    expectedExitStatus: 42,
    buildOnly: true,
    sourceSnapshot,
    sourceSnapshotPath: join(output, "workspace.sources.json"),
    fixture: "tools/build-native-contention-fixture.ts",
    fixtureSources,
    imageSha256: sha(built.value.bytes),
    imageBytes: built.value.bytes.length,
    codeSha256: sha(generated.code),
    casLeafSha256: sha(generated.casLeafBytes),
    leafAudit: generated.leafAudit,
    policy: {
      width,
      iterationsPerWorker: 1000,
      workers: 2,
      mappingBytes: 16384,
      anonymousPrivateFlags: 0x1002,
      startBarrier:
        "both ready, controller start, both initial reads before first CAS, both first CAS attempts finish before either worker advances",
      minimumObservedMismatches: 1,
      firstAttemptCompletionGate: generated.firstAttemptGate,
      workerSpinBudget: 0x3fffffff,
      workerMismatchBudget: 1000 * 1024,
      managedHeap: false,
      runtimeContext: false,
      allowJit: false,
      frameBytes: generated.frameBytes,
    },
    layout: generated.layout,
    abi: {
      pthreadCreate:
        "x0=&raw pthread_t,x1=NULL,x2=platform worker entry,x3=record; w0=status",
      pthreadJoin: "x0=raw pthread_t,x1=&raw void* result; w0=status",
      worker:
        "x0=scalar record; x0=NULL success or (void*)1 failure; preserves x19..x29,x30,SP and d8..d15",
      handleTransport:
        "raw 64-bit load/store only; never Number or FP conversion",
      cleanup:
        "abort releases started workers; join every successfully created worker; munmap only after successful joins; retain mapping until process exit on join error",
    },
    sdk: { root: sdkRoot, version: sdkSettings.Version, files: sdkFiles },
    imports: generated.imports,
    functions,
    codeFileOffset: built.value.codeFileOffset,
    entryFileOffset: built.value.entryFileOffset,
    sourceBeforeAfterEqual: true,
    failureExitStatuses: {
      1: "mmap failed",
      2: "mapping outside exact private address domain",
      3: "first pthread_create failed",
      4: "second pthread_create failed",
      5: "ready barrier exhausted",
      6: "pthread_join failed (mapping retained)",
      7: "worker status/return/completed count invalid",
      8: "forced first-read contention absent",
      9: "counter or neighboring bytes incorrect",
      10: "munmap failed",
    },
    limits: [
      "Not executed by builder; root must observe native entry and exit42 under LLDB.",
      "Cooperative model is not hardware concurrency evidence.",
      "No Script agents, waiter implementation, managed allocation, shared GC context or default permissions.",
      "pthread_join has no timeout; root's independent containment remains required.",
    ],
  };
  writeFileSync(
    path + ".build.json",
    JSON.stringify(metadata, null, 2) + "\n",
    { flag: "wx" },
  );
  artifacts.push(metadata);
}
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify({ sourceSnapshot, artifacts }, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    sourceSnapshot,
    manifest: join(output, "manifest.json"),
    artifacts: artifacts.map((item) => item.binary),
  }),
);
