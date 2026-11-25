import { nativeFixtureBuildOnlyMode } from "./gate/native-fixture.ts";
import { nativeFixtureMemoryWaiting } from "./gate/native-batch-clock.ts";
import { killGateProcess, runWithDeadline } from "./gate/watchdog.ts";
// Native runtime diagnostics (docs/runtime-diagnostics.md): each opted-in
// image is built through the hosted pipeline and run under LLDB.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  assertTrace,
  runCapturingStandardError,
  typedStackTraceExpected,
  typedStackTraceFixture,
} from "./verify-hosted-stack-traces.ts";
import {
  assertProbeRun,
  buildSignpostFixture,
  recordProbesUnderGdb,
  runUnderLldb,
} from "./verify-hosted-signposts.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

process.env.TINT_BUILD_ONLY = nativeFixtureBuildOnlyMode();

test(
  "an uncaught throw prints its value and a symbolicated origin trace",
  {
    skip:
      nativeFixtureTarget().arch === "x86_64" &&
      "linux-x86_64 does not yet support stackTraces diagnostics",
  },
  () => {
    const image = verifyHostedFixture(
      typedStackTraceFixture,
      "stack-traces-test",
      [],
      [],
      [],
      [],
      { managedBytes: 4194304, allocationCapacity: 65536, stackTraces: true },
    );
    try {
      const run = runCapturingStandardError(image);
      assert.equal(run.status, 70, run.session);
      assertTrace(run.stderr, typedStackTraceExpected);
    } finally {
      rmSync(dirname(image), { recursive: true, force: true });
    }
  },
);

test("default images report nothing for an uncaught throw", () => {
  const image = verifyHostedFixture(
    typedStackTraceFixture,
    "stack-traces-default-test",
  );
  try {
    const run = runCapturingStandardError(image);
    assert.equal(
      run.status,
      nativeFixtureTarget().arch === "x86_64" ? 1 : 70,
      run.session,
    );
    assert.equal(run.stderr, "");
  } finally {
    rmSync(dirname(image), { recursive: true, force: true });
  }
});

test("signposted collector phases keep the generational runtime correct", () => {
  const image = buildSignpostFixture("signposts-test");
  try {
    runUnderLldb(image);
    if (process.platform === "linux") {
      // USDT probes: stapsdt notes, hit at every interval edge under GDB.
      const notes = spawnSync("readelf", ["--notes", image], {
        encoding: "utf8",
      });
      assert.equal(notes.status, 0, notes.stderr);
      assert.match(notes.stdout, /stapsdt\s+0x[0-9a-f]+\s+NT_STAPSDT/);
      assert.match(notes.stdout, /Provider: tint\s+Name: gc__end/);
      const run = recordProbesUnderGdb(image);
      assert.equal(run.exitCode, 42, run.session);
      assertProbeRun(run);
      return;
    }
    // libtrace requires interval names in __TEXT,__cstring.
    const sections = spawnSync("otool", ["-l", image], { encoding: "utf8" });
    assert.match(sections.stdout, /sectname __cstring\s+segname __TEXT/);
    const bytes = readFileSync(image).toString("latin1");
    for (const name of [
      "dev.tint.runtime",
      "gc.collect",
      "gc.worker",
      "alloc.slow",
    ])
      assert.ok(bytes.includes(name + "\0"), name);
  } finally {
    rmSync(dirname(image), { recursive: true, force: true });
  }
});

test("LLDB loads registered JIT code: breakpoints, backtrace, lines and perf map", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-jit-debug-test-"));
  try {
    const journal = process.env.TINT_GATE_NATIVE_IMAGES;
    const worker = Number(process.env.TINT_GATE_NATIVE_WORKER_PID);
    let verified = false;
    const status = await runWithDeadline(
      process.execPath,
      ["tools/verify-hosted-jit-debug.ts", join(directory, "out")],
      600,
      {
        env: { ...process.env, TINT_BUILD_ONLY: "" },
        onTimeout: killGateProcess,
        onInterrupt: killGateProcess,
        onLine: (line) => {
          if (line.includes("Verified JIT debugger registration"))
            verified = true;
        },
        waiting:
          journal && Number.isSafeInteger(worker)
            ? nativeFixtureMemoryWaiting(journal, worker)
            : undefined,
      },
    );
    assert.equal(status, 0);
    assert.ok(verified, "expected the JIT debugger registration marker");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
