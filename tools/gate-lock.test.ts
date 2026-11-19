import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("all gate acquisitions keep their lock files", () => {
  const exclusive = readFileSync(
    new URL("./gate/exclusive-step.sh", import.meta.url),
    "utf8",
  );
  const semaphore = readFileSync(
    new URL("./gate/lock.ts", import.meta.url),
    "utf8",
  );
  assert.match(exclusive, /^exec \/usr\/bin\/lockf -k\s/m);
  assert.match(semaphore, /spawnSync\(\s*"\/usr\/bin\/lockf",\s*\["-k",/);
});

test(
  "an exclusive step kills a stalled process tree and releases the lock",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const evidence = mkdtempSync(join(tmpdir(), "tint-gate-watchdog-"));
    const lock = join(evidence, "exclusive.lock");
    const timing = join(evidence, "locks.tsv");
    const pids = join(evidence, "pids");
    try {
      const result = spawnSync(
        "sh",
        [
          fileURLToPath(new URL("./gate/exclusive-step.sh", import.meta.url)),
          "fake",
          process.execPath,
          "--input-type=module",
          "-e",
          `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        const child = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
        writeFileSync(process.argv[1], process.pid + " " + child.pid);
      `,
          pids,
        ],
        {
          encoding: "utf8",
          timeout: 20_000,
          killSignal: "SIGKILL",
          env: {
            ...process.env,
            TINT_GATE_EXCLUSIVE_LOCK: lock,
            TINT_GATE_LOCK_TIMING: timing,
            TINT_GATE_EVIDENCE: evidence,
            TINT_GATE_STEP_TIMEOUT: "1",
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 124, result.stderr);
      assert.match(result.stderr, /STALL.*fake.*1s/);
      assert.match(
        readFileSync(join(evidence, "stalls.tsv"), "utf8"),
        /^fake\t1\t/m,
      );
      assert.match(readFileSync(timing, "utf8"), /^fake\t/m);
      const processes = readFileSync(pids, "utf8").split(" ").map(Number);
      const report = readFileSync(join(evidence, "stall-fake.txt"), "utf8");
      assert.match(
        report,
        new RegExp(
          `(?:Analysis of sampling .*\\(pid ${processes[1]}\\)|sample failed for PID ${processes[1]}:)`,
        ),
      );

      for (const pid of processes) {
        // A killed orphan may still be visible as a zombie while it is reaped.
        const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
          encoding: "utf8",
        }).stdout.trim();
        assert.match(state, /^(?:Z.*)?$/, "still running: " + pid);
      }
      const next = spawnSync("/usr/bin/lockf", ["-k", "-t", "0", lock, "true"]);
      assert.ifError(next.error);
      assert.equal(next.status, 0);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  },
);

test(
  "a watched bootstrap stage records its memory slot and duration",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const memory = mkdtempSync(join(tmpdir(), "tint-gate-stage-"));
    try {
      const result = spawnSync(
        "sh",
        [
          "-eu",
          "-c",
          ". tools/gate/common.sh; stage_step stage2 memory-watchdog true",
        ],
        {
          env: {
            ...process.env,
            TINT_GATE_MEMORY_DIRECTORY: memory,
            TINT_GATE_MEMORY_SLOTS: "1",
          },
          encoding: "utf8",
        },
      );
      assert.ifError(result.error);
      const evidence = /^head=\S+ evidence=(.+)$/m.exec(result.stdout)?.[1];
      assert.ok(evidence, result.stdout + result.stderr);
      try {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const timing = readFileSync(join(evidence, "locks.tsv"), "utf8")
          .trim()
          .split("\t");
        assert.deepEqual(timing.slice(0, 2), [
          "stage2",
          join(memory, "slot-1.lock"),
        ]);
        assert.match(timing[2]!, /^\d+$/);
        assert.match(timing[3]!, /^\d+$/);
      } finally {
        rmSync(evidence, { recursive: true, force: true });
      }
    } finally {
      rmSync(memory, { recursive: true, force: true });
    }
  },
);
