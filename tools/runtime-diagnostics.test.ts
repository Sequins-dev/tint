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

process.env.TINT_BUILD_ONLY = "1";

test("an uncaught throw prints its value and a symbolicated origin trace", () => {
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
});

test("default images report nothing for an uncaught throw", () => {
  const image = verifyHostedFixture(
    typedStackTraceFixture,
    "stack-traces-default-test",
  );
  try {
    const run = runCapturingStandardError(image);
    assert.equal(run.status, 70, run.session);
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

test(
  "LLDB loads registered JIT code: breakpoints, backtrace, lines and perf map",
  { timeout: 600000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-jit-debug-test-"));
    try {
      const result = spawnSync(
        process.execPath,
        ["tools/verify-hosted-jit-debug.ts", join(directory, "out")],
        {
          encoding: "utf8",
          timeout: 600000,
          env: { ...process.env, TINT_BUILD_ONLY: "" },
        },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Verified JIT debugger registration/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
