import assert from "node:assert/strict";
import { test } from "node:test";
import { hasProperty, programRealmCore } from "@tint/js-runtime/objects";
import { createJobQueue, drainJobs, enqueueJob } from "@tint/js-runtime/jobs";
import { createEventLoop } from "../src/event-loop.ts";
import { installNodeEventLoopGlobals } from "../src/node/event-loop-globals.ts";

function fixture() {
  let now = 0;
  const pollTimeouts: number[] = [];
  const microtasks = createJobQueue<undefined>();
  let onPoll: (() => void) | undefined;
  const loop = createEventLoop({
    now: () => now,
    poll: (timeout) => {
      assert(Number.isFinite(timeout));
      pollTimeouts.push(timeout);
      if (onPoll === undefined) now += timeout;
      else onPoll();
    },
    drainMicrotasks: () => {
      drainJobs(microtasks, (job) => job());
    },
  });
  return {
    loop,
    pollTimeouts,
    microtask: (callback: () => void) =>
      enqueueJob(microtasks, callback, undefined),
    advance: (duration: number) => {
      now += duration;
    },
    onPoll: (callback: (() => void) | undefined) => {
      onPoll = callback;
    },
  };
}

test("the application realm installs only standard scheduling globals", () => {
  const { loop } = fixture();
  const core = programRealmCore();
  installNodeEventLoopGlobals(loop, core.object, core.realm, core.hooks);
  for (const name of ["process", "setImmediate", "clearImmediate"])
    assert.equal(hasProperty(core.object, name), false, name);
  for (const name of [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "queueMicrotask",
  ])
    assert.equal(hasProperty(core.object, name), true, name);
});

for (const entry of ["callback", "microtask"] as const)
  test("event loop checkpoints after " + entry + " entry", () => {
    const { loop, microtask, pollTimeouts } = fixture();
    const trace: string[] = [];
    loop.nextTick(() => {
      trace.push("tick");
      loop.nextTick(() => trace.push("tick from tick"));
      microtask(() => trace.push("microtask from tick"));
    });
    microtask(() => {
      trace.push("promise");
      loop.nextTick(() => trace.push("tick from promise"));
    });
    microtask(() => trace.push("microtask"));

    loop.run(entry);
    assert.deepEqual(
      trace,
      entry === "callback"
        ? [
            "tick",
            "tick from tick",
            "promise",
            "microtask",
            "microtask from tick",
            "tick from promise",
          ]
        : [
            "promise",
            "microtask",
            "tick",
            "tick from promise",
            "tick from tick",
            "microtask from tick",
          ],
    );
    assert.deepEqual(pollTimeouts, []);
  });

test("ready I/O, the check phase and close run before timers", () => {
  const { loop, microtask, pollTimeouts, onPoll } = fixture();
  const trace: string[] = [];
  const reading = loop.retain();
  onPoll(() => {
    loop.enqueueIO(() => {
      reading.close();
      trace.push("io");
      loop.setTimeout(() => trace.push("timer"), 0);
      loop.setImmediate(() => {
        trace.push("immediate");
        loop.nextTick(() => trace.push("immediate tick"));
        microtask(() => trace.push("immediate microtask"));
        loop.setImmediate(() => trace.push("nested immediate"));
      });
      loop.setImmediate(() => trace.push("second immediate"));
      loop.enqueueClose(() => trace.push("close"));
    });
    onPoll(undefined);
  });
  // A referenced timer bounds poll while the read is pending.
  const limit = loop.setTimeout(() => assert.fail("read did not close"), 10);
  loop.enqueuePending(() => {
    trace.push("pending");
    loop.clearTimeout(limit);
    loop.setTimeout(() => trace.push("guard"), 3);
  });
  loop.run("callback");
  assert.deepEqual(trace, [
    "pending",
    "io",
    "immediate",
    "immediate tick",
    "immediate microtask",
    "second immediate",
    "close",
    "nested immediate",
    "timer",
    "guard",
  ]);
  assert.deepEqual(pollTimeouts, [3, 0, 1, 2]);
});

test("a retained handle with no timers waits for readiness without a deadline", () => {
  const timeouts: number[] = [];
  const loop = createEventLoop({
    now: () => 0,
    poll: (timeout) => {
      timeouts.push(timeout);
      reading.close();
    },
    drainMicrotasks: () => {},
  });
  const reading = loop.retain();
  loop.run("callback");
  assert.deepEqual(timeouts, [Infinity]);
});

for (const deadline of [2 ** 31 - 1, 2 ** 31, 2 ** 31 + 0.5])
  test("internal deadlines survive capped polls at " + deadline, () => {
    const timerLimit = 2 ** 31 - 1;
    let now = 0;
    const timeouts: number[] = [];
    const loop = createEventLoop({
      now: () => now,
      poll: (timeout) => {
        assert(timeouts.length < 2, "the deadline must not poll in 1 ms steps");
        timeouts.push(timeout);
        now += Math.min(timerLimit, Math.ceil(timeout));
      },
      drainMicrotasks: () => {},
    });
    let completedAt = -1;
    loop.scheduleDeadline(() => (completedAt = now), deadline);
    loop.run("callback");
    assert.equal(completedAt, Math.ceil(deadline));
    assert.deepEqual(
      timeouts,
      deadline <= timerLimit ? [deadline] : [deadline, deadline - timerLimit],
    );
  });

test("public timeouts retain Node's out-of-range delay handling", () => {
  const { loop, pollTimeouts } = fixture();
  loop.setTimeout(() => {}, 2 ** 31);
  loop.run("callback");
  assert.deepEqual(pollTimeouts, [1]);
});

test("timer order is stable and an overdue interval runs once per timers pass", () => {
  const { loop, advance, pollTimeouts } = fixture();
  const trace: string[] = [];
  const interval = loop.setInterval(() => {
    trace.push("interval");
    if (trace.length === 1) advance(10);
    else loop.clearTimeout(interval);
  }, 2.9);
  loop.setTimeout(() => trace.push("same deadline"), 2);
  loop.setTimeout(() => trace.push("later deadline"), 5);

  loop.run("callback");
  assert.deepEqual(trace, [
    "interval",
    "same deadline",
    "interval",
    "later deadline",
  ]);
  assert.deepEqual(pollTimeouts, [2, 0]);
});

test("clear and ref state do not leave empty handles keeping the loop alive", () => {
  const { loop, pollTimeouts } = fixture();
  const timer = loop.setTimeout(() => assert.fail("timer ran"), 500);
  const immediate = loop.setImmediate(() => assert.fail("immediate ran"));
  const cancelled = loop.setInterval(() => assert.fail("interval ran"), 1);
  const handle = loop.retain();
  assert.equal(timer.unref(), timer);
  assert.equal(immediate.unref(), immediate);
  assert.equal(immediate.hasRef(), false);
  loop.clearInterval(cancelled);
  cancelled.ref();
  handle.unref();
  loop.run("callback");
  assert.deepEqual(pollTimeouts, []);
  assert.equal(timer.ref(), timer);
  assert.equal(timer.hasRef(), true);
  loop.clearTimeout(timer);
  loop.clearImmediate(immediate);
  assert.equal(immediate.ref().hasRef(), false);
  handle.close();
  loop.run("callback");
  assert.deepEqual(pollTimeouts, []);
});

test("a throwing callback is consumed and an aborted pass preserves subsequent work", () => {
  const { loop } = fixture();
  let calls = 0;
  const failure = new Error("callback failed");
  loop.setImmediate(() => {
    throw failure;
  });
  loop.setImmediate(() => calls++);
  assert.throws(
    () => loop.run("callback"),
    (thrown) => thrown === failure,
  );
  assert.equal(calls, 0);
  loop.run("callback");
  assert.equal(calls, 1);
});

test("the entry checkpoint defers host turns until the current job has finished", () => {
  const { loop, microtask } = fixture();
  let calls = 0;
  loop.setImmediate(() => calls++);
  microtask(() => {
    assert.throws(() => loop.run("callback"), /EVENT_LOOP_REENTRANCY/);
    assert.equal(calls, 0);
  });
  loop.checkpoint("microtask");
  assert.equal(calls, 0);
  loop.run("callback");
  assert.equal(calls, 1);
});

test("checkpointWithin runs a callback's checkpoint between the events it delivers", () => {
  const order: string[] = [];
  const microtasks: (() => void)[] = [];
  const loop = createEventLoop({
    drainMicrotasks: (): void => {
      while (microtasks.length > 0) microtasks.shift()?.();
    },
    poll: (): void => {},
    now: (): number => 0,
  });
  assert.throws(() => loop.checkpointWithin());
  loop.enqueueIO((): void => {
    for (const name of ["first", "second"]) {
      order.push(name);
      microtasks.push((): void => {
        order.push("after " + name);
      });
      if (name === "first") loop.checkpointWithin();
    }
  });
  loop.run("callback");
  assert.deepEqual(order, ["first", "after first", "second", "after second"]);
});
