import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeTargetOSDarwin, nativeTargetOSLinux } from "@tint/abi/host";
import { nativeHostTarget, targetFileHost } from "../src/host.ts";
import { createNativeFileHost as darwinFileHost } from "../src/darwin/fs.ts";
import { createNativeFileHost as linuxFileHost } from "../src/linux/fs.ts";
import { darwinAArch64Target, linuxAArch64Target } from "../src/target.ts";

test("each target's file host reports that target's errno values", () => {
  assert.equal(targetFileHost(darwinAArch64Target), darwinFileHost());
  assert.equal(targetFileHost(linuxAArch64Target), linuxFileHost());
  assert.notEqual(darwinFileHost(), linuxFileHost());
});

test("host ABIs name the operating system target-os reports", () => {
  assert.equal(darwinAArch64Target.hostABI.os, "darwin");
  assert.equal(linuxAArch64Target.hostABI.os, "linux");
  assert.notEqual(nativeTargetOSDarwin, nativeTargetOSLinux);
});

test("the host target is a native build fact, unavailable under Node", () => {
  assert.throws(nativeHostTarget, (error) => error === "HOST_UNAVAILABLE");
});
