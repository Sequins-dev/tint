// lldbStartCommands builds the LLDB batch arguments that import the launch
// driver and start the target stopped at entry; stream paths are quoted the
// way the driver splits its arguments (shell words).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { lldbStartCommands } from "./lldb-launch.ts";

test("the launch commands import the driver and quote stream paths", () => {
  const [importFlag, importCommand, startFlag, start] = lldbStartCommands({
    stdin: "/dev/null",
    stderr: "/tmp/it's here/err.txt",
  });
  assert.equal(importFlag, "-o");
  assert.equal(startFlag, "-o");
  const driver = JSON.parse(
    (importCommand ?? "").slice("command script import ".length),
  );
  assert.ok(driver.endsWith("/tools/lldb/native_launch.py"), driver);
  assert.ok(existsSync(driver));
  assert.equal(
    start,
    "tint_start --stdin '/dev/null' --stderr '/tmp/it'\\''s here/err.txt'",
  );
  assert.deepEqual(lldbStartCommands().slice(2), ["-o", "tint_start"]);
});
