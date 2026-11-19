import { test } from "node:test";
import assert from "node:assert/strict";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  linuxX86_64Target,
} from "@tint/platform/target";
import { nodeHostTarget } from "./native-host-target.ts";

test("Node-run builds default to the Node host's target", () => {
  assert.equal(nodeHostTarget("linux", "arm64"), linuxAArch64Target);
  assert.equal(nodeHostTarget("linux", "x64"), linuxX86_64Target);
  assert.equal(nodeHostTarget("darwin", "arm64"), darwinAArch64Target);
  assert.equal(
    nodeHostTarget(),
    process.platform === "linux"
      ? process.arch === "x64"
        ? linuxX86_64Target
        : linuxAArch64Target
      : darwinAArch64Target,
  );
});
