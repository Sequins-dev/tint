import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeNativeProcess,
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
