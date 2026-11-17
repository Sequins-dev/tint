import { test } from "node:test";
import assert from "node:assert/strict";
import { darwinAArch64Target, linuxAArch64Target } from "@tint/platform/target";
import { nodeHostTarget } from "./native-host-target.ts";

test("Node-run builds default to the Node host's target", () => {
  assert.equal(nodeHostTarget("linux"), linuxAArch64Target);
  assert.equal(nodeHostTarget("darwin"), darwinAArch64Target);
  assert.equal(
    nodeHostTarget(),
    process.platform === "linux" ? linuxAArch64Target : darwinAArch64Target,
  );
});
