import assert from "node:assert/strict";
import test from "node:test";
import { Heartbeat, heartbeatSettings } from "./test262-native-heartbeat.ts";

test("heartbeat intervals are bounded integers and zero disables only the heartbeat", () => {
  assert.deepEqual(heartbeatSettings({}), {
    intervalMs: 30000,
    stallMs: 150000,
  });
  assert.deepEqual(heartbeatSettings({ TINT_TEST262_HEARTBEAT_MS: "0" }), {
    intervalMs: 0,
    stallMs: 150000,
  });
  assert.deepEqual(
    heartbeatSettings({
      TINT_TEST262_HEARTBEAT_MS: "10",
      TINT_TEST262_STALL_MS: "20",
    }),
    { intervalMs: 10, stallMs: 20 },
  );
  for (const value of [
    "",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "2147483648",
    "1e3",
    " ",
  ]) {
    assert.throws(
      () => heartbeatSettings({ TINT_TEST262_HEARTBEAT_MS: value }),
      /TINT_TEST262_HEARTBEAT_MS/,
    );
    assert.throws(
      () => heartbeatSettings({ TINT_TEST262_STALL_MS: value }),
      /TINT_TEST262_STALL_MS/,
    );
  }
  assert.throws(
    () => heartbeatSettings({ TINT_TEST262_STALL_MS: "0" }),
    /TINT_TEST262_STALL_MS/,
  );
});

test("transitions, elapsed time, counts, repeated stalls, pause path and timer disposal", () => {
  let now = 0,
    tick = () => {},
    cleared = 0,
    unref = 0;
  const lines: string[] = [];
  const heartbeat = new Heartbeat(
    { intervalMs: 10, stallMs: 20 },
    {
      now: () => now,
      write: (line) => lines.push(line),
      waitingPids: () => "child=123 inferior=456",
      schedule: (callback) => {
        tick = callback;
        return {
          unref: () => {
            unref++;
          },
        };
      },
      cancel: () => {
        cleared++;
      },
    },
  );
  heartbeat.update({
    selection: "language/comments",
    phase: "compiling batch 0 (8 variants)",
    since: 0,
    total: 8,
    done: 0,
    pass: 0,
    fail: 0,
    unsupported: 0,
    infra: 0,
  });
  assert.equal(lines.length, 1);
  assert.match(
    lines[0]!,
    /1970-01-01T00:00:00.000Z.*language\/comments.*compiling batch 0 \(8 variants\).*elapsed=0ms.*done=0\/8.*pass=0 fail=0 unsupported=0 infra=0/,
  );
  now = 10;
  tick();
  assert.doesNotMatch(lines.at(-1)!, /STALL/);
  now = 20;
  tick();
  assert.match(lines.at(-1)!, /STALL.*elapsed=20ms.*child=123 inferior=456/);
  heartbeat.update({
    ...heartbeat.state!,
    phase: "paused on /tmp/native pause",
    since: now,
    done: 3,
    pass: 1,
    fail: 1,
    infra: 1,
  });
  now = 30;
  tick();
  assert.match(
    lines.at(-1)!,
    /paused on \/tmp\/native pause.*elapsed=10ms.*done=3\/8/,
  );
  now = 40;
  tick();
  tick();
  assert.match(lines.at(-1)!, /STALL.*paused on/);
  heartbeat.close();
  heartbeat.close();
  assert.equal(cleared, 1);
  assert.equal(unref, 1);
  const length = lines.length;
  tick();
  assert.equal(lines.length, length);
});

test("disabled heartbeat emits neither transitions nor periodic lines", () => {
  const heartbeat = new Heartbeat(
    { intervalMs: 0, stallMs: 10 },
    {
      write: () => assert.fail("disabled output"),
      schedule: () => {
        throw Error("disabled timer");
      },
    },
  );
  heartbeat.update({
    selection: ".",
    phase: "writing report",
    since: 0,
    total: 0,
    done: 0,
    pass: 0,
    fail: 0,
    unsupported: 0,
    infra: 0,
  });
  heartbeat.close();
});

test("worker emits stderr while the runner blocks and closes on success and error", async () => {
  const { spawnSync } = await import("node:child_process");
  const module = new URL("./test262-native-heartbeat.ts", import.meta.url).href;
  for (const fail of [false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import {startNativeHeartbeat} from ${JSON.stringify(module)};
      import {spawnSync} from "node:child_process";
      const heartbeat = startNativeHeartbeat("worker-test");
      try {
        heartbeat.phase("paused on /tmp/worker-test");
        spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300)"]);
        if (${fail}) throw Error("expected test error");
        console.log(JSON.stringify({unchanged: true}));
      } finally { await heartbeat.close(); }
    `,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          TINT_TEST262_HEARTBEAT_MS: "20",
          TINT_TEST262_STALL_MS: "40",
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    const paused = result.stderr
      .split("\n")
      .filter((line) => line.includes("paused on"));
    assert.ok(paused.length >= 3, result.stderr);
    assert.match(result.stderr, /STALL.*child\/inferior=\d+/);
    assert.equal(result.stdout, fail ? "" : '{"unchanged":true}\n');
  }
});
