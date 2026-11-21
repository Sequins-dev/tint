// FFI call-overhead microbenchmark (docs/native-ffi.md): a Tint direct leaf
// c-call, a Tint host operation and Node's node:ffi on the same C calls.
// Each native loop times itself with the monotonic clock and prints
// ns/call; images are built with TINT_BUILD_ONLY semantics and run under
// LLDB (stopped at entry, exit status 42 asserted). Run under
//   tools/gate/with-lock.sh both ffi-microbench node tools/ffi-microbench.ts
// node:ffi needs Node 26 (NODE26=<path to node> selects it).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts",
  diagnostics = "packages/native-runtime/src/intrinsics/diagnostics.ts",
  libsystem = "packages/native-runtime/src/c/libsystem.d.ts",
  commoncrypto = "packages/native-runtime/src/c/commoncrypto.d.ts";
const iterations = Number(process.env.FFI_BENCH_N ?? "100000000"),
  hashIterations = Math.floor(iterations / 20);

/** One native timing loop; `body(i)` returns a number to accumulate. */
function loop(name: string, setup: string, body: string, n: number): string {
  return `{
  ${setup}
  let sum = 0;
  const start = monotonicMilliseconds();
  for (let i = 0; i < ${n}; i++) sum += ${body};
  const elapsed = monotonicMilliseconds() - start;
  console.log(${JSON.stringify(name)} + " " + String(elapsed * 1000000 / ${n}) + " ns/call (checksum " + String(sum) + ")");
}`;
}
const source = `import { monotonicMilliseconds } from "clock";
import { processId } from "diagnostics";
import { getpid } from "tint:c/libsystem";
import { CC_SHA256_CTX, CC_SHA256_Init, CC_SHA256_Update } from "tint:c/commoncrypto";
export function run(): number {
${loop("tint c-call getpid()", "", "getpid()", iterations)}
${loop("tint host-call processId()", "", "processId()", iterations)}
${loop(
  "tint c-call CC_SHA256_Update(64 B)",
  "const context = new Uint8Array(CC_SHA256_CTX.size); CC_SHA256_Init(context); const block = new Uint8Array(64);",
  "CC_SHA256_Update(context, block, 64)",
  hashIterations,
)}
  return 42;
}
`;

function runNative(path: string): string {
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped",
      "-o",
      "continue",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
      path,
    ],
    { encoding: "utf8", timeout: 600000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  return result.stdout
    .split("\n")
    .filter((line) => line.includes("ns/call"))
    .join("\n");
}

process.env.TINT_BUILD_ONLY = "1";
const image = verifyHostedFixture(
  source,
  "ffi-microbench",
  [
    ["clock", clock],
    ["diagnostics", diagnostics],
    ["tint:c/libsystem", libsystem],
    ["tint:c/commoncrypto", commoncrypto],
  ],
  [],
  [],
  [
    {
      module: clock,
      namespace: "bench-clock",
      retainedExports: ["monotonicMilliseconds"],
    },
    {
      module: diagnostics,
      namespace: "bench-diagnostics",
      retainedExports: ["processId"],
    },
  ],
  {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    hostBindings: [
      {
        module: clock,
        name: "monotonicMilliseconds",
        operation: "monotonic-time",
      },
      { module: diagnostics, name: "processId", operation: "process-id" },
    ],
  },
);
console.log("image " + image);
console.log(runNative(image));

const node26 = process.env.NODE26;
if (node26 === undefined)
  console.log("node:ffi skipped (set NODE26 to a Node 26 binary)");
else {
  const directory = mkdtempSync(join(tmpdir(), "tint-ffi-bench-"));
  try {
    const script = join(directory, "bench.mjs");
    writeFileSync(
      script,
      `import ffi from "node:ffi";
import { createHash } from "node:crypto";
const { lib, functions: f } = ffi.dlopen(null, {
  getpid: { arguments: [], return: "int32" },
  CC_SHA256_Init: { arguments: ["buffer"], return: "int32" },
  CC_SHA256_Update: { arguments: ["buffer", "buffer", "uint32"], return: "int32" },
});
function time(name, n, fn) {
  for (let i = 0; i < Math.min(n, 1000000); i++) fn();
  const start = process.hrtime.bigint();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += fn();
  const ns = Number(process.hrtime.bigint() - start) / n;
  console.log(name + " " + ns + " ns/call (checksum " + sum + ")");
}
const context = new Uint8Array(104), block = new Uint8Array(64);
f.CC_SHA256_Init(context);
time("node:ffi getpid()", ${Math.min(iterations, 20000000)}, () => f.getpid());
time("node:ffi CC_SHA256_Update(64 B)", ${Math.min(hashIterations, 2000000)}, () => f.CC_SHA256_Update(context, block, 64));
const hash = createHash("sha256");
time("node crypto hash.update(64 B)", ${Math.min(hashIterations, 2000000)}, () => (hash.update(block), 1));
lib.close();
`,
    );
    const result = spawnSync(node26, [script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    console.log(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
