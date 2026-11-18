import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  admitNativeFile,
  executeNativeProcess,
  NativeImageRunner,
  selectNativeDebuggerLaunch,
} from "./test262-native-process.ts";

/** A stand-in image: exits with 40 + the selected case, or misbehaves. */
function script(body: string): { path: string; dispose: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "tint-process-launch-"));
  const path = join(directory, "image");
  writeFileSync(path, "#!/bin/sh\n" + body + "\n");
  chmodSync(path, 0o755);
  return { path, dispose: () => rmSync(directory, { recursive: true }) };
}

test("process launch is the default and debugger modes remain selectable", () => {
  assert.equal(selectNativeDebuggerLaunch("darwin", undefined), "process");
  assert.equal(selectNativeDebuggerLaunch("linux", undefined), "process");
  assert.equal(selectNativeDebuggerLaunch("darwin", "process"), "process");
  assert.equal(
    selectNativeDebuggerLaunch("darwin", "debugserver-direct"),
    "debugserver-direct",
  );
});

test("a directly launched image reports its exit status as the outcome", () => {
  const image = script("exit $((40 + $1))");
  try {
    assert.deepEqual(executeNativeProcess(image.path, 10000, 2), {
      kind: "completed",
    });
    assert.equal(executeNativeProcess(image.path, 10000, 0).kind, "error");
  } finally {
    image.dispose();
  }
});

test("a signal is a crash and an overrun is a timeout", () => {
  const crashing = script("kill -SEGV $$"),
    hanging = script("sleep 30");
  try {
    const crash = executeNativeProcess(crashing.path, 10000, 0);
    assert.equal(crash.kind, "crash");
    assert.match(crash.kind === "crash" ? crash.detail : "", /SIGSEGV/);
    const started = Date.now();
    assert.equal(executeNativeProcess(hanging.path, 300, 0).kind, "timeout");
    assert.ok(Date.now() - started < 10000, "the overrun is killed");
  } finally {
    crashing.dispose();
    hanging.dispose();
  }
});

/** Stand-in image bytes: without a case argument (the admission launch) it
 * first logs and waits `stall` seconds, like a host's first-launch
 * assessment; with one it logs the case and exits 42 at once. */
function stallingImage(log: string, stall: string): Uint8Array {
  return new TextEncoder().encode(
    `#!/bin/sh\nif [ $# -eq 0 ]; then echo admit >> ${log}; sleep ${stall}; exit 99; fi\necho "case $1" >> ${log}\nexit 42\n`,
  );
}

test("first-launch admission is charged to its own budget, once per image", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-admission-"));
  const log = join(directory, "log");
  // The case budget (400 ms) is shorter than the admission stall (1 s): a
  // case must not pay for it, as when the host assesses a new executable.
  const image = new NativeImageRunner(stallingImage(log, "1"), 400, 10000);
  try {
    const phases: string[] = [];
    assert.deepEqual(
      image.run(0, (phase) => phases.push(phase)),
      { kind: "completed" },
    );
    assert.deepEqual(image.run(1), { kind: "completed" });
    const admission = image.admit();
    assert.equal(admission.admitted, true);
    assert.ok(admission.admissionMs >= 900, "the stall is measured");
    assert.deepEqual(phases, ["admitting image", "running"]);
    assert.equal(readFileSync(log, "utf8"), "admit\ncase 0\ncase 1\n");
  } finally {
    image.close();
    rmSync(directory, { recursive: true });
  }
});

test("an image the host never admits runs no case and reports a timeout", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-admission-"));
  const log = join(directory, "log");
  const image = new NativeImageRunner(stallingImage(log, "30"), 10000, 1500);
  try {
    const started = Date.now();
    for (const index of [0, 1]) {
      const outcome = image.run(index);
      assert.equal(outcome.kind, "timeout");
      assert.match(
        outcome.kind === "timeout" ? (outcome.detail ?? "") : "",
        /not admitted.*within 1500 ms; no case was executed/,
      );
    }
    assert.ok(Date.now() - started < 10000, "the stalled launch is killed");
    // The host may not even have started the stand-in before the deadline.
    assert.ok(!existsSync(log) || readFileSync(log, "utf8") === "admit\n");
  } finally {
    image.close();
    rmSync(directory, { recursive: true });
  }
});

test("an image that cannot be spawned fails admission as a crash", () => {
  const admission = admitNativeFile("/nonexistent/tint-image", 1000);
  assert.equal(admission.admitted, false);
  assert.equal(admission.admitted ? "" : admission.outcome.kind, "crash");
  assert.equal(existsSync("/nonexistent/tint-image"), false);
});
