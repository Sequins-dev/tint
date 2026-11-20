import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withGateLock } from "./gate/lock.ts";
import * as fixturePhases from "./gate/native-fixture.ts";
import { nativeBatchWaiting } from "./gate/native-batch-clock.ts";
const { buildNativeFixture, beginNativeFixtureExecution } = fixturePhases;

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

test("macOS bootstrap stages use the exclusive lock", () => {
  const gate = readFileSync(
    new URL("./gate/mac-gate.sh", import.meta.url),
    "utf8",
  );
  assert.match(gate, /^stage_lldb exclusive stage1 stage2$/m);
  assert.match(gate, /^stage_lldb exclusive stage2 stage3$/m);
  assert.match(gate, /^bootstrap memory$/m);
  assert.match(gate, /^run_step freeze memory /m);
  assert.match(gate, /^run_step compare unlocked /m);
});

test(
  "a watched bootstrap stage records its exclusive lock and duration",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-gate-stage-"));
    const lock = join(directory, "exclusive.lock");
    try {
      const result = spawnSync(
        "sh",
        [
          "-eu",
          "-c",
          ". tools/gate/common.sh; stage_step stage2 exclusive true",
        ],
        {
          env: {
            ...process.env,
            TINT_GATE_EXCLUSIVE_LOCK: lock,
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
        assert.deepEqual(timing.slice(0, 2), ["stage2", lock]);
        assert.match(timing[2]!, /^\d+$/);
        assert.match(timing[3]!, /^\d+$/);
      } finally {
        rmSync(evidence, { recursive: true, force: true });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "the macOS gate budget includes admission wait and names the step that overruns",
  { skip: process.platform !== "darwin" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-gate-budget-"));
    try {
      const tool = fileURLToPath(new URL("./gate/lock.ts", import.meta.url));
      const run = () =>
        spawnSync(
          process.execPath,
          [
            tool,
            "mac-budget",
            "mac-gate",
            "sh",
            "-c",
            "echo '2026-01-01T00:00:00Z start check-native resource=exclusive log=test'; exec sleep 30",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              TINT_GATE_BUDGET: "1",
              TINT_GATE_ADMISSION_DIRECTORY: directory,
            },
            timeout: 5000,
          },
        );
      const active = run();
      assert.equal(active.status, 124, active.stderr);
      assert.match(active.stderr, /BUDGET.*check-native/);
      withGateLock([join(directory, "slot-1.lock")], "outer", undefined, () =>
        withGateLock(
          [join(directory, "slot-2.lock")],
          "inner",
          undefined,
          () => {
            const queued = run();
            assert.equal(queued.status, 124, queued.stderr);
            assert.match(queued.stderr, /BUDGET.*admission/);
            assert.equal(queued.stdout, "");
          },
        ),
      );
      const available = spawnSync(
        process.execPath,
        [tool, "mac-budget", "mac-gate", "true"],
        {
          env: { ...process.env, TINT_GATE_ADMISSION_DIRECTORY: directory },
          timeout: 5000,
        },
      );
      assert.equal(available.status, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("fixture preparation releases its memory slot before admission and records phases", async () => {
  if (process.platform !== "darwin") return;
  const directory = mkdtempSync(join(tmpdir(), "tint-fixture-phases-"));
  try {
    const slot = join(directory, "slot-1.lock");
    const exclusive = join(directory, "native.lock");
    const image = join(directory, "image");
    const evidence = join(directory, "native-images.jsonl");
    const probe = (file: string) =>
      spawnSync("/usr/bin/lockf", ["-ks", "-t", "0", file, "true"]).status;
    const env = {
      TINT_GATE_NATIVE_IMAGES: evidence,
      TINT_GATE_MEMORY_DIRECTORY: directory,
      TINT_GATE_MEMORY_SLOTS: "1",
      TINT_GATE_EXCLUSIVE_LOCK: exclusive,
    };
    assert.equal(
      buildNativeFixture(
        "fixture",
        () => {
          assert.equal(probe(slot), 75);
          assert.equal(probe(exclusive), 0);
          writeFileSync(image, "image");
          return image;
        },
        env,
      ),
      image,
    );
    for (let i = 0; i < 2; i++) {
      const release = await beginNativeFixtureExecution(
        image,
        () => {
          assert.equal(probe(slot), 0);
          assert.equal(probe(exclusive), 75);
        },
        env,
      );
      assert.equal(probe(exclusive), 75);
      release();
    }
    assert.equal(probe(exclusive), 0);
    const rows = readFileSync(evidence, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows
        .filter((row) => !row.phase.endsWith("-start"))
        .map((row) => row.phase),
      [
        "build",
        "lock-wait",
        "admission",
        "execution",
        "lock-release",
        "lock-wait",
        "execution",
        "lock-release",
      ],
    );
    assert.ok(
      rows
        .filter((row) => row.phase !== "build-start")
        .every(
          (row) => row.path === image && row.bytes === 5 && row.elapsedMs >= 0,
        ),
    );
    assert.equal(rows.filter((row) => row.phase === "build-start").length, 1);
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./gate/native-fixture.ts", import.meta.url)),
        evidence,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /built=1 admitted=1 launch-attempted=1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "concurrent fixtures in one worker let the holder finish before the next launch",
  { skip: process.platform !== "darwin" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-native-contention-"));
    try {
      const journal = join(directory, "native-images.jsonl");
      const images = [join(directory, "first"), join(directory, "second")];
      for (const image of images) writeFileSync(image, "fixture");
      const result = spawnSync(
        process.execPath,
        [
          "--import=" +
            new URL("./gate/native-worker.ts", import.meta.url).href,
          "--input-type=module",
          "-e",
          `
          import assert from "node:assert/strict";
          import { setImmediate } from "node:timers/promises";
          import { beginNativeFixtureExecution } from ${JSON.stringify(new URL("./gate/native-fixture.ts", import.meta.url).href)};
          import { nativeBatchWaiting } from ${JSON.stringify(new URL("./gate/native-batch-clock.ts", import.meta.url).href)};
          const [first, second] = process.argv.slice(1);
          const waiting = nativeBatchWaiting(process.env.TINT_GATE_NATIVE_IMAGES);
          const releaseFirst = await beginNativeFixtureExecution(first, undefined);
          const next = beginNativeFixtureExecution(second, () => assert.ok(released));
          let released = false;
          await setImmediate();
          assert.equal(waiting(), false, "the holder is still active");
          releaseFirst();
          released = true;
          assert.equal(waiting(), true, "only the queued fixture remains");
          const releaseSecond = await next;
          assert.equal(waiting(), false, "the second fixture is now active");
          releaseSecond();
        `,
          ...images,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          killSignal: "SIGKILL",
          env: {
            ...process.env,
            TINT_GATE_NATIVE_WORKER_PID: "",
            TINT_GATE_NATIVE_IMAGES: journal,
            TINT_GATE_EXCLUSIVE_LOCK: join(directory, "native.lock"),
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("the native test deadline starts after admission", () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TINT_GATE_NATIVE_IMAGES: "enabled",
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { setTimeout as delay } from "node:timers/promises";
        import { testNativeLaunch } from ${JSON.stringify(new URL("./gate/native-launch-test.ts", import.meta.url).href)};

        testNativeLaunch("queued", { timeout: 30 }, async (onAdmitted) => {
          await delay(100);
          onAdmitted();
        });
        testNativeLaunch("over deadline", { timeout: 30 }, async (onAdmitted) => {
          onAdmitted();
          await delay(100);
        });
        `,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /✔ queued/);
  assert.match(result.stdout, /✖ over deadline/);
  assert.match(result.stdout, /Native launch test timed out after 30ms/);
});

test(
  "the native watchdog excludes a held launch lock from its active budget",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-native-watchdog-"));
    try {
      const lock = join(directory, "native.lock");
      const journal = join(directory, "native-images.jsonl");
      const image = join(directory, "image");
      writeFileSync(image, "fixture");
      const result = spawnSync(
        "sh",
        [
          "-eu",
          "-c",
          `
      /usr/bin/lockf -k "$1" sh -c 'touch "$1"; sleep 2.5' holder "$2" &
      until [ -f "$2" ]; do sleep 0.01; done
      exec "$3" "$4" watchdog check-native "$3" --import="$6" --input-type=module -e "$5"
    `,
          "fixture",
          lock,
          join(directory, "ready"),
          process.execPath,
          fileURLToPath(new URL("./gate/lock.ts", import.meta.url)),
          `
      import { beginNativeFixtureExecution } from ${JSON.stringify(new URL("./gate/native-fixture.ts", import.meta.url).href)};
      const release = await beginNativeFixtureExecution(${JSON.stringify(image)}, () => {});
      release();
      console.log("fixture completed");
    `,
          new URL("./gate/native-worker.ts", import.meta.url).href,
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            TINT_GATE_STEP_TIMEOUT: "1",
            TINT_GATE_NATIVE_WORKER_PID: "",
            TINT_GATE_EVIDENCE: directory,
            TINT_GATE_NATIVE_IMAGES: journal,
            TINT_GATE_EXCLUSIVE_LOCK: lock,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /fixture completed/);
      assert.match(result.stdout, /all-workers-wait-ms=[1-9][0-9]{3}/);
      assert.ok(
        readFileSync(journal, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .some((row) => row.phase === "lock-wait" && row.elapsedMs > 1000),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("a lock waiter does not pause the watchdog while another worker is active", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-native-clock-"));
  try {
    const journal = join(directory, "native-images.jsonl");
    const waiting = nativeBatchWaiting(journal);
    assert.equal(waiting(), false);
    const events: object[] = [];
    const record = (phase: string, worker: number) => {
      events.push({ phase, worker });
      writeFileSync(
        journal,
        events.map((event) => JSON.stringify(event)).join("\n") + "\n",
      );
    };
    record("worker-start", 1);
    record("worker-start", 2);
    record("lock-wait-start", 1);
    assert.equal(waiting(), false);
    record("lock-wait-start", 2);
    assert.equal(waiting(), true);
    record("lock-wait", 1);
    assert.equal(waiting(), false);
    record("worker-end", 1);
    assert.equal(waiting(), true);
    record("worker-end", 2);
    assert.equal(waiting(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
