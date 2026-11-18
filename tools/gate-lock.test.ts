import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withGateLock } from "./gate/lock.ts";

test(
  "a gate lock spans execution and releases on failure",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-gate-lock-"));
    try {
      const file = join(directory, "lock");
      const log = join(directory, "timing.tsv");
      const probe = () =>
        spawnSync("/usr/bin/lockf", ["-ks", "-t", "0", file, "true"]).status;
      assert.equal(probe(), 0);
      assert.throws(
        () =>
          withGateLock([file], "launch", log, () => {
            assert.equal(probe(), 75);
            throw Error("fixture failure");
          }),
        /fixture failure/,
      );
      assert.equal(probe(), 0);
      assert.match(readFileSync(log, "utf8"), /^launch\t\S+\t\d+\t\d+\n$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
