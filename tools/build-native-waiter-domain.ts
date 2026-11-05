import { buildAArch64Executable } from "./aarch64-executable.ts";
/** Build only: bounded native waiter kernel, no production facet or agent API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { waiterCode } from "./native-waiter-domain.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  saveWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("waiter fixture requires TINT_BUILD_ONLY=1");
const output = resolve(
  process.argv[2] ?? ".tint-bootstrap/native-waiter-w1-artifacts-v1",
);
mkdirSync(output);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const snapshot = workspaceSources(),
  sourceSnapshot = workspaceSourceIdentity(snapshot);
saveWorkspaceSourceSnapshot(join(output, "workspace.sources.json"), snapshot);
const tools = [
  "tools/native-waiter-domain.ts",
  "tools/native-waiter-model.ts",
  "tools/native-waiter-domain.test.ts",
  "tools/build-native-waiter-domain.ts",
  "tools/native-contention-fixture.ts",
  "tools/native-contention-leaf-audit.ts",
];
mkdirSync(join(output, "tools"));
const fixtureSources = tools.map((path) => {
  copyFileSync(path, join(output, path));
  return { path, sha256: sha(readFileSync(path)) };
});
const sdkRoot = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
  sdkFile = (file: string) => readFileSync(join(sdkRoot, file), "utf8");
const settings = JSON.parse(sdkFile("SDKSettings.json")),
  types = sdkFile("usr/include/sys/_pthread/_pthread_types.h"),
  pthread = sdkFile("usr/include/pthread/pthread.h"),
  errno = sdkFile("usr/include/sys/errno.h"),
  timespec = sdkFile("usr/include/sys/_types/_timespec.h"),
  armTypes = sdkFile("usr/include/arm/_types.h"),
  clock = sdkFile("usr/include/_time.h");
const lp64 = /#if defined\(__LP64__\)([\s\S]*?)#else/.exec(types)?.[1];
assert.ok(lp64);
const mutexOpaque = Number(
    /#define\s+__PTHREAD_MUTEX_SIZE__\s+(\d+)/.exec(lp64)?.[1],
  ),
  conditionOpaque = Number(
    /#define\s+__PTHREAD_COND_SIZE__\s+(\d+)/.exec(lp64)?.[1],
  );
assert.match(
  types,
  /struct _opaque_pthread_mutex_t\s*\{\s*long __sig;\s*char __opaque\[__PTHREAD_MUTEX_SIZE__\];/,
);
assert.match(
  types,
  /struct _opaque_pthread_cond_t\s*\{\s*long __sig;\s*char __opaque\[__PTHREAD_COND_SIZE__\];/,
);
assert.match(timespec, /__darwin_time_t tv_sec;\s*long\s+tv_nsec;/);
assert.match(armTypes, /typedef long\s+__darwin_time_t;/);
assert.match(
  pthread,
  /int pthread_cond_timedwait_relative_np\(pthread_cond_t \*, pthread_mutex_t \*,\s*const struct timespec \* _Nullable\)/,
);
assert.match(errno, /#define\s+ETIMEDOUT\s+60\b/);
assert.match(errno, /#define\s+EINTR\s+4\b/);
assert.match(clock, /_CLOCK_MONOTONIC_RAW\s+__CLOCK_AVAILABILITY\s*=\s*4/);
assert.match(clock, /__uint64_t clock_gettime_nsec_np\(clockid_t __clock_id\)/);
const generated = waiterCode();
assert.deepEqual(generated.sdkLayout, {
  mutexBytes: 8 + mutexOpaque,
  conditionBytes: 8 + conditionOpaque,
  alignment: 8,
  timespecBytes: 16,
  etimedout: 60,
  eintr: 4,
});
const sdkPaths = [
  "SDKSettings.json",
  "usr/include/pthread/pthread.h",
  "usr/include/sys/_pthread/_pthread_types.h",
  "usr/include/sys/errno.h",
  "usr/include/sys/_types/_timespec.h",
  "usr/include/arm/_types.h",
  "usr/include/_time.h",
];
const sdkFiles = sdkPaths.map((path) => ({
  path,
  sha256: sha(readFileSync(join(sdkRoot, path))),
}));
const [major, minor, patch] = String(settings.Version).split(".").map(Number);
assert.ok(major !== undefined && minor !== undefined);
const functions = [
    { name: "main", offset: 0, byteLength: generated.waitOffset },
    {
      name: "waiter_entry",
      offset: generated.waitOffset,
      byteLength: generated.notifyOffset - generated.waitOffset,
    },
    {
      name: "notify_entry",
      offset: generated.notifyOffset,
      byteLength: generated.code.length - generated.notifyOffset,
    },
  ],
  emitter = readFileSync("tools/native-waiter-domain.ts", "utf8"),
  line = (needle: string) =>
    emitter.slice(0, emitter.indexOf(needle)).split("\n").length;
const built = buildAArch64Executable({
  code: generated.code,
  entryOffset: 0,
  identifier: "tint.native-waiter.w1",
  minimumOS: { major: 13, minor: 0, patch: 0 },
  sdk: { major, minor, patch: patch ?? 0 },
  allowDebugger: true,
  allowJit: false,
  imports: generated.imports,
  addressFixups: generated.addressFixups,
  symbols: functions.map((fn) => ({ name: "_" + fn.name, offset: fn.offset })),
  debug: {
    directory: resolve("."),
    functions,
    lines: functions.map((fn, index) => ({
      offset: fn.offset,
      byteLength: fn.byteLength,
      file: "tools/native-waiter-domain.ts",
      line: line(
        index === 0
          ? 'label("main")'
          : index === 1
            ? 'label("wait")'
            : 'label("notify")',
      ),
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
for (const f of fixtureSources)
  assert.equal(
    sha(readFileSync(f.path)),
    f.sha256,
    "fixture changed during build",
  );
const binary = join(output, "native-waiter-w1");
writeFileSync(binary, built.value.bytes, { flag: "wx", mode: 0o755 });
const metadata = {
  binary,
  expectedExitStatus: 42,
  buildOnly: true,
  sourceSnapshot,
  sourceSnapshotPath: join(output, "workspace.sources.json"),
  fixture: "tools/build-native-waiter-domain.ts",
  fixtureSources,
  imageSha256: sha(built.value.bytes),
  imageBytes: built.value.bytes.length,
  codeSha256: sha(generated.code),
  sdk: {
    root: sdkRoot,
    version: settings.Version,
    files: sdkFiles,
    layout: generated.sdkLayout,
    derivation:
      "Darwin arm64 LP64 long/pointer=8, align8; full mutex8+56=64 and cond8+40=48 (not opaque-array sizes alone); timespec two signed longs=16; errno and clock ids checked against SDK",
  },
  functions,
  imports: generated.imports,
  codeFileOffset: built.value.codeFileOffset,
  entryFileOffset: built.value.entryFileOffset,
  layout: generated.layout,
  abi: {
    frameBytes: 96,
    bridge:
      "exact seven-instruction prologue/epilogue slices from proven T1 emitter; x19..x29/x30/SP restored; x18 and FP/SIMD untouched",
    worker:
      "pthread-compatible void*(void*) scalar record, no managed function/context ABI",
    mutexCondition:
      "real SDK objects initialized via direct libSystem imports; all queue authority under one domain mutex",
    rawWordTransport:
      "pthread handles, pointer results, payload64 and monotonic nanoseconds never pass through Number/FP in generated native code",
  },
  checks: [
    "mismatch result2,active0,parkCalls0",
    "matching synchronous timeout0 result3,active0,parkCalls>=1 via actual relative timed-wait",
    "worker0 registered/parked before worker1; both native condition waits reached under locked handshake",
    "count0,wrong byte offset and wrong block take domain mutex; no signals/removals",
    "width8 count1 notifies FIFO width4 worker0; width4 wake-all notifies remaining width8 worker1",
    "states/active counts/exact signal counts,worker return/status checks,payload/canary preservation",
    "join every created thread before destroying initialized cond/mutex objects and unmapping; abort wakes/removes pending registrations",
  ],
  policy: {
    waiters: 2,
    blockId: 7,
    payloadByteOffset: 0,
    payloadMappedOffset: 256,
    workerTimeoutSeconds: 5,
    deadlineClock:
      "CLOCK_MONOTONIC_RAW=4; raw uint64 deadline; spurious/EINTR remaining time recomputed exactly",
    controllerRelativeTimeoutSeconds: 5,
    controllerMaxParksPerPhase: 16,
    workerMaxSpuriousParks: 1000000,
    managedHeap: false,
    sharedGCContext: false,
    allowJit: false,
    productionCapability: false,
  },
  sourceBeforeAfterEqual: true,
  failureExitStatuses: {
    1: "mmap",
    2: "mutex init",
    3: "condition init",
    4: "mismatch path",
    5: "zero timed-park path",
    7: "initial controller lock",
    8: "first create",
    9: "second create",
    10: "registration ordering/park handshake",
    11: "controller wait error/timeout/budget",
    12: "initial controller unlock",
    13: "empty notify validation lock",
    14: "empty notify unlock",
    15: "first completion lock",
    16: "first completion unlock",
    17: "all completion lock",
    18: "all completion unlock",
    19: "notification count/state/identity",
    20: "abort lock",
    21: "abort unlock",
    22: "join (retain mapping)",
    23: "worker results/payload/canaries",
    24: "condition destroy (retain mapping)",
    25: "mutex destroy (retain mapping)",
    26: "munmap",
    27: "unrecoverable controller ABI error (process-lifetime retention)",
  },
  limits: [
    "Build-only; parent must verify native entry and actual exit42 under LLDB.",
    "Bounded fixed two-slot prototype, no Script/S0 notifications facet or wait/agent API advertised.",
    "Not a proof of generalized waitAsync/ticket-generation/collector/worker support.",
    "Worker deadlines are absolute monotonic; controller is a diagnostic bounded relative-park loop, not a production timer service.",
    "No cancellation API. Unknown join/destroy/lock failures retain mappings until process exit rather than reclaim live resources.",
    "pthread_join has no timeout; independent parent containment required.",
  ],
};
writeFileSync(
  binary + ".build.json",
  JSON.stringify(metadata, null, 2) + "\n",
  { flag: "wx" },
);
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify({ sourceSnapshot, artifacts: [metadata] }, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    sourceSnapshot,
    binary,
    manifest: join(output, "manifest.json"),
  }),
);
