import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withGateLock } from "./gate/lock.ts";
import * as fixturePhases from "./gate/native-fixture.ts";
import {
  nativeBatchWaiting,
  nativeFixtureMemoryWaiting,
} from "./gate/native-batch-clock.ts";
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
    new URL("./gate/with-lock.sh", import.meta.url),
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
  "the macOS gate enforces its active budget",
  { skip: process.platform !== "darwin" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-gate-budget-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          "tools/gate/lock.ts",
          "mac-budget",
          "mac-gate",
          "sh",
          "-c",
          "echo '2026-01-01T00:00:00Z start sample resource=unlocked log=test'; exec sleep 30",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            TINT_GATE_BUDGET: "1",
            TINT_GATE_ADMISSION_DIRECTORY: directory,
          },
          timeout: 10_000,
        },
      );
      assert.equal(result.status, 124, result.stderr);
      assert.match(result.stderr, /BUDGET.*active.*sample/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("a fixture watchdog excludes only its worker's memory admission wait", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-fixture-memory-clock-"));
  try {
    const journal = join(directory, "images.jsonl");
    const waiting = nativeFixtureMemoryWaiting(journal, 101);
    assert.equal(waiting(), false);
    writeFileSync(journal, '{"phase":"memory-wait-start","worker":102}\n');
    assert.equal(waiting(), false);
    writeFileSync(journal, '{"phase":"memory-wait-start","worker":101}\n', {
      flag: "a",
    });
    assert.equal(waiting(), true);
    writeFileSync(journal, '{"phase":"build-start","worker":102}\n', {
      flag: "a",
    });
    assert.equal(waiting(), true);
    writeFileSync(journal, '{"phase":"build-start","worker":101}\n', {
      flag: "a",
    });
    assert.equal(waiting(), false);
    writeFileSync(journal, '{"phase":"lock-wait-start","worker":101}\n', {
      flag: "a",
    });
    assert.equal(waiting(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const resource of ["exclusive", "smoke"])
  test(
    `a macOS ${resource} step can queue past the former wall cap and pass`,
    { skip: process.platform !== "darwin" },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "tint-gate-queue-budget-"));
      try {
        const probe = join(directory, "probe.ts");
        writeFileSync(
          probe,
          `import { gateLaunch } from ${JSON.stringify(new URL("./gate/lock.ts", import.meta.url).href)};
        gateLaunch("nested", process.argv[2], []);`,
        );
        const payload = join(directory, "payload.ts");
        writeFileSync(payload, 'console.log("null");');
        const result = spawnSync(
          "sh",
          [
            "-eu",
            "-c",
            `
          /usr/bin/lockf -k "$TINT_GATE_EXCLUSIVE_LOCK" sh -c 'touch "$1"; sleep 3' holder "$1" &
          holder=$!
          until [ -e "$1" ]; do sleep 0.02; done
          "$2" tools/gate/lock.ts mac-budget mac-gate sh -eu -c '
            . tools/gate/common.sh
            if [ "$1" = exclusive ]; then
              gate_step_timeout=1 run_step queued exclusive true
            else
              run_step queued memory env TINT_GATE_LAUNCH_LOCK="$TINT_GATE_EXCLUSIVE_LOCK" TINT_GATE_STEP_TIMEOUT=1 node "$2" "$3"
            fi
          ' gate-step "$3" "$4" "$5"
          wait "$holder"
        `,
            "test",
            join(directory, "ready"),
            process.execPath,
            resource,
            probe,
            payload,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              TINT_GATE_BUDGET: "2",
              TINT_GATE_WALL_TIMEOUT: "1",
              TINT_GATE_ADMISSION_DIRECTORY: directory,
              TINT_GATE_MEMORY_DIRECTORY: join(directory, "memory"),
              TINT_GATE_EXCLUSIVE_LOCK: join(directory, "launch.lock"),
            },
            timeout: 10_000,
          },
        );
        const evidence = /^head=\S+ evidence=(.+)$/m.exec(result.stdout)?.[1];
        try {
          assert.ifError(result.error);
          assert.equal(result.status, 0, result.stdout + result.stderr);
          const step =
            /gate-step step=queued active-ms=(\d+) queue-ms=(\d+)/.exec(
              result.stdout,
            );
          assert.ok(step, result.stdout);
          assert.ok(Number(step[1]) < 1000, result.stdout);
          assert.ok(Number(step[2]) >= 2000, result.stdout);
          assert.match(
            result.stdout,
            /gate-budget active-ms=\d+ queue-ms=[2-9]\d{3}/,
          );
        } finally {
          if (evidence) rmSync(evidence, { recursive: true, force: true });
        }
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
        "memory-wait",
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
        .filter((row) => row.path !== undefined)
        .every(
          (row) => row.path === image && row.bytes === 5 && row.elapsedMs >= 0,
        ),
    );
    assert.deepEqual(
      rows.slice(0, 3).map((row) => row.phase),
      ["memory-wait-start", "memory-wait", "build-start"],
    );
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

test("memory-slot and launch wait together pause the native batch", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-native-clock-"));
  try {
    const journal = join(directory, "native-images.jsonl");
    const waiting = nativeBatchWaiting(journal);
    const events = [
      { phase: "worker-start", worker: 1 },
      { phase: "worker-start", worker: 2 },
      { phase: "lock-wait-start", worker: 1 },
      { phase: "memory-wait-start", worker: 2 },
    ];
    const update = () =>
      writeFileSync(
        journal,
        events.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
    update();
    assert.equal(waiting(), true);
    events.push({ phase: "memory-wait", worker: 2 });
    update();
    assert.equal(waiting(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "a stalled timing command kills its debugger and inferior and releases both locks",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-timing-watchdog-"));
    try {
      const timing = join(directory, "timing.lock");
      const launch = join(directory, "launch.lock");
      const pids = join(directory, "pids");
      const idle = spawnSync(
        "sh",
        [
          fileURLToPath(new URL("./gate/with-lock.sh", import.meta.url)),
          "both",
          "profile",
          process.execPath,
          "--input-type=module",
          "-e",
          `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        const inferior = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
        process.kill(inferior.pid, "SIGSTOP");
        writeFileSync(process.env.TINT_GATE_INFERIOR_PID_FILE, String(inferior.pid));
        writeFileSync(process.argv[1], process.pid + " " + inferior.pid);
      `,
          pids,
        ],
        {
          env: {
            ...process.env,
            TINT_GATE_EXCLUSIVE_LOCK: launch,
            TINT_GATE_TIMING_LOCK: timing,
            TINT_GATE_EVIDENCE: directory,
            TINT_GATE_INFERIOR_PID_FILE: join(directory, "inferior.pid"),
            TINT_GATE_STEP_TIMEOUT: "30",
            TINT_GATE_IDLE_TIMEOUT: "1",
          },
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      assert.ifError(idle.error);
      assert.equal(idle.status, 125, idle.stderr);
      const [debuggerPid, inferior] = readFileSync(pids, "utf8").split(" ");
      const report = readFileSync(join(directory, "stall-profile.txt"), "utf8");
      assert.match(
        report,
        new RegExp(`^ *${inferior} +${debuggerPid} +T`, "m"),
      );
      assert.match(report, /Analysis of sampling|sample failed/);
      for (const pid of [debuggerPid!, inferior!]) {
        const state = spawnSync("/bin/ps", ["-p", pid, "-o", "state="], {
          encoding: "utf8",
        }).stdout.trim();
        assert.match(state, /^(?:Z.*)?$/, "still running: " + pid);
      }
      for (const lock of [timing, launch]) {
        assert.equal(
          spawnSync("/usr/bin/lockf", ["-ks", "-t", "0", lock, "true"]).status,
          0,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "a dual-lock waiter leaves timing available and its watchdog starts on acquisition",
  { skip: process.platform !== "darwin" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-dual-lock-"));
    try {
      const launch = join(directory, "launch.lock");
      const timing = join(directory, "timing.lock");
      const result = spawnSync(
        "sh",
        [
          "-eu",
          "-c",
          `
          release="$1.release"
          /usr/bin/lockf -k "$TINT_GATE_EXCLUSIVE_LOCK" sh -c '
            touch "$1"
            until [ -f "$2" ]; do sleep 0.01; done
          ' holder "$1" "$release" &
          holder=$!
          trap 'touch "$release"; wait "$holder"' EXIT
          until [ -f "$1" ]; do sleep 0.01; done
          sh tools/gate/with-lock.sh both benchmark "$2" -e '
            const end = performance.now() + 2200;
            while (performance.now() < end) {}
            console.log("measured");
          ' &
          waiter=$!
          sleep 1.5
          /usr/bin/lockf -k -t 0 "$TINT_GATE_TIMING_LOCK" true
          touch "$release"
          wait "$holder"
          trap - EXIT
          wait "$waiter"
        `,
          "queue",
          join(directory, "ready"),
          process.execPath,
        ],
        {
          env: {
            ...process.env,
            TINT_GATE_EXCLUSIVE_LOCK: launch,
            TINT_GATE_TIMING_LOCK: timing,
            TINT_GATE_EVIDENCE: directory,
            TINT_GATE_IDLE_TIMEOUT: "1",
            TINT_GATE_STEP_TIMEOUT: "10",
          },
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /measured/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

function runDualLockScenario(script: string) {
  const evidence = mkdtempSync(join(tmpdir(), "tint-dual-lock-queue-"));
  try {
    const wrapper = fileURLToPath(
      new URL("./gate/with-lock.sh", import.meta.url),
    );
    const result = spawnSync(
      "sh",
      ["-eu", "-c", script, "dual-lock-test", wrapper],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          TINT_GATE_EXCLUSIVE_LOCK: join(evidence, "launch.lock"),
          TINT_GATE_TIMING_LOCK: join(evidence, "timing.lock"),
          TINT_GATE_EVIDENCE: evidence,
          TINT_GATE_STEP_TIMEOUT: "10",
          TINT_GATE_IDLE_TIMEOUT: "5",
        },
        cwd: evidence,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

const dualLockScenario = `
  wrapper=$1
  hold() {
    /usr/bin/lockf -k "$1" sh -eu -c '
      touch "$1.ready"
      for i in $(seq 400); do
        test ! -e "$1.release" || exit 0
        sleep 0.02
      done
      exit 1
    ' holder "$2"
  }
  await_file() {
    for i in $(seq 100); do
      test ! -e "$1" || return 0
      sleep 0.02
    done
    echo "Did not see $1" >&2
    return 1
  }
  await_queue() {
    for i in $(seq 100); do
      queued_pid=$(ps -axww -o pid=,ppid=,command= | awk -v pid="\${2:-$waiter}" -v lock="$1" '
        $2 == pid && $3 == "/usr/bin/lockf" && $(NF-1) == lock && $NF == "/usr/bin/true" { print $1 }')
      test -z "$queued_pid" || return 0
      sleep 0.02
    done
    echo "Dual-lock job did not queue on $1" >&2
    return 1
  }
  trap 'touch launch.release timing.release' EXIT
`;

test(
  "a dual-lock request releases launch while it queues behind a separate timing holder",
  { skip: process.platform !== "darwin" },
  () => {
    runDualLockScenario(
      dualLockScenario +
        `
      hold "$TINT_GATE_EXCLUSIVE_LOCK" launch &
      launch_holder=$!
      hold "$TINT_GATE_TIMING_LOCK" timing &
      timing_holder=$!
      await_file launch.ready
      await_file timing.ready
      "$wrapper" both dual touch ran &
      waiter=$!
      await_queue "$TINT_GATE_EXCLUSIVE_LOCK"
      touch launch.release
      wait "$launch_holder"
      await_queue "$TINT_GATE_TIMING_LOCK"
      /usr/bin/lockf -k -t 0 "$TINT_GATE_EXCLUSIVE_LOCK" /usr/bin/true
      test ! -e ran
      touch timing.release
      wait "$timing_holder"
      wait "$waiter"
      test -e ran
    `,
    );
  },
);

test(
  "a queued dual-lock request progresses amid repeated single-lock contenders",
  { skip: process.platform !== "darwin" },
  () => {
    runDualLockScenario(
      dualLockScenario +
        `
      hold "$TINT_GATE_EXCLUSIVE_LOCK" launch &
      holder=$!
      await_file launch.ready
      "$wrapper" both dual touch ran &
      waiter=$!
      await_queue "$TINT_GATE_EXCLUSIVE_LOCK"
      first_waiter=$queued_pid
      # Single-lock traffic begins before the current launch holder releases.
      (
        /usr/bin/lockf -k "$TINT_GATE_EXCLUSIVE_LOCK" /usr/bin/true
        for i in $(seq 40); do
          /usr/bin/lockf -k "$TINT_GATE_EXCLUSIVE_LOCK" sleep 0.035
          test ! -e ran || exit 0
          sleep 0.02
        done
        echo "Single-lock traffic drained before the dual request ran" >&2
        exit 1
      ) &
      contenders=$!
      await_queue "$TINT_GATE_EXCLUSIVE_LOCK" "$contenders"
      # The initial dual-lock waiter keeps its queue position across long holds.
      sleep 2.5
      kill -0 "$first_waiter"
      touch launch.release
      wait "$holder"
      wait "$contenders"
      wait "$waiter"
      test -e ran
    `,
    );
  },
);
