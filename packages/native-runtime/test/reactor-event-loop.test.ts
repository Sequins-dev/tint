import assert from "node:assert/strict";
import { test } from "node:test";
import { createReactorEventLoop } from "../src/event-loop-reactor.ts";

test("synchronous and immediate-only turns never allocate a reactor", () => {
  const runtime = createReactorEventLoop({
    createReactor: () => assert.fail("opened an idle reactor"),
    now: () => 0,
    drainMicrotasks: () => {},
    onWake: () => {},
  });
  let calls = 0;
  runtime.loop.run("callback");
  runtime.loop.setImmediate(() => calls++);
  runtime.loop.run("callback");
  runtime.close();
  assert.equal(calls, 1);
});

test("closing an old registration discards stale readiness after fd reuse", () => {
  let poll: (emit: (token: number) => void) => void;
  const tokens = new Map<number, number>();
  const execution: string[] = [];
  const runtime = createReactorEventLoop({
    createReactor: () => ({
      control: 99,
      watchReadable: (fd, token) => tokens.set(fd, token),
      unwatchReadable: (fd) => tokens.delete(fd),
      poll: (_ms, emit) => poll(emit),
      close: () => execution.push("close"),
    }),
    now: () => 0,
    drainMicrotasks: () => {},
    onWake: () => execution.push("wake"),
  });
  const first = runtime.watchReadable(7, () => assert.fail("stale callback"));
  assert.throws(() => runtime.watchReadable(7, () => {}), /already watched/);
  const stale = tokens.get(7)!;
  first.close();
  const current = runtime.watchReadable(7, () => {
    execution.push("read");
    current.close();
  });
  poll = (emit) => {
    emit(stale);
    emit(0);
    emit(tokens.get(7)!);
    emit(tokens.get(7)!);
  };
  assert.equal(runtime.wakeTarget(), 99);
  runtime.loop.run("callback");
  runtime.close();
  runtime.close();
  assert.deepEqual(execution, ["wake", "read", "close"]);
  assert.equal(tokens.size, 0);
});

test("a stop request during a blocked poll prevents dispatching ready turns", () => {
  let stop = false;
  let token = 0;
  let polls = 0;
  const runtime = createReactorEventLoop({
    createReactor: () => ({
      control: 99,
      watchReadable: (_fd, id) => (token = id),
      unwatchReadable: () => {},
      poll: (timeout, emit) => {
        assert.equal(timeout, Infinity);
        assert.equal(++polls, 1);
        stop = true;
        emit(token);
      },
      close: () => {},
    }),
    now: () => 0,
    drainMicrotasks: () => {},
    onWake: () => {},
    stopRequested: () => stop,
  });
  runtime.watchReadable(7, () => assert.fail("ran after the stop request"));
  runtime.loop.run("callback");
  runtime.close();
  assert.equal(polls, 1);
});

function idleFixture(step: number) {
  let clock = 0;
  const timeouts: number[] = [];
  const runtime = createReactorEventLoop({
    createReactor: () => ({
      control: 1,
      watchReadable: () => {},
      unwatchReadable: () => {},
      poll: (timeout) => {
        timeouts.push(timeout);
        if (timeout !== 0) watch.close();
      },
      close: () => {},
    }),
    now: () => (clock += step),
    drainMicrotasks: () => {},
    onWake: () => {},
  });
  const watch = runtime.watchReadable(5, () => assert.fail("no readiness"));
  return { runtime, timeouts, watch, clock: () => clock };
}

test("an idle source that finds work skips the blocking poll and defers descriptor checks", () => {
  const f = idleFixture(0.001);
  const calls: string[] = [];
  let queued = 3;
  let armed = false;
  const stop = f.runtime.pollWhileIdle({
    arm: () => {
      calls.push("arm");
      armed = true;
      return true;
    },
    ready: () => armed && queued > 0,
    settle: () => {
      calls.push("settle");
      armed = false;
      if (queued === 0) return false;
      f.runtime.loop.enqueueIO(() => {
        calls.push("deliver");
        if (--queued === 0) {
          stop();
          f.watch.close();
        }
      });
      return true;
    },
  });
  f.runtime.loop.run("callback");
  f.runtime.close();
  assert.deepEqual(calls, [
    "arm",
    "settle",
    "deliver",
    "arm",
    "settle",
    "deliver",
    "arm",
    "settle",
    "deliver",
  ]);
  // Every turn found work within one readiness interval: no system poll.
  assert.deepEqual(f.timeouts, []);
});

test("an idle source checks descriptors once a readiness interval passes", () => {
  // Each clock read advances 0.3 ms, so every other turn is a millisecond
  // past the last descriptor check.
  const f = idleFixture(0.3);
  let queued = 4;
  const stop = f.runtime.pollWhileIdle({
    arm: () => true,
    ready: () => true,
    settle: () => {
      f.runtime.loop.enqueueIO(() => {
        if (--queued === 0) {
          stop();
          f.watch.close();
        }
      });
      return true;
    },
  });
  f.runtime.loop.run("callback");
  f.runtime.close();
  assert.equal(queued, 0);
  assert.deepEqual(f.timeouts, [0, 0]);
});

test("an idle source that stays empty settles and the loop blocks for the full timeout", () => {
  const f = idleFixture(0.004);
  const calls: string[] = [];
  let readies = 0;
  f.runtime.pollWhileIdle({
    arm: () => {
      calls.push("arm");
      return true;
    },
    ready: () => {
      readies++;
      return false;
    },
    settle: () => {
      calls.push("settle");
      return false;
    },
  });
  // A source that does not arm takes no part in the spin.
  f.runtime.pollWhileIdle({
    arm: () => false,
    ready: () => assert.fail("polled an unarmed source"),
    settle: () => false,
  });
  f.runtime.loop.run("callback");
  f.runtime.close();
  assert.deepEqual(calls, ["arm", "settle"]);
  assert.deepEqual(f.timeouts, [Infinity]);
  // The spin is bounded: about 0.05 ms of polling at 0.004 ms per check.
  assert.ok(readies >= 5 && readies <= 13, String(readies));
});

test("an idle spin counts against the next timer's timeout", () => {
  let clock = 0;
  const timeouts: number[] = [];
  let spun = 0;
  const runtime = createReactorEventLoop({
    createReactor: () => ({
      control: 1,
      watchReadable: () => {},
      unwatchReadable: () => {},
      poll: (timeout) => {
        timeouts.push(timeout);
        clock += timeout;
      },
      close: () => {},
    }),
    now: () => clock,
    drainMicrotasks: () => {},
    onWake: () => {},
  });
  const stop = runtime.pollWhileIdle({
    arm: () => true,
    ready: () => {
      spun++;
      clock += 0.001;
      return false;
    },
    settle: () => false,
  });
  let fired = false;
  runtime.loop.setTimeout(() => {
    fired = true;
    stop();
  }, 1);
  runtime.loop.run("callback");
  runtime.close();
  assert.ok(fired);
  // About 0.05 ms of polling, then the rest of the millisecond blocked.
  assert.ok(spun >= 45 && spun <= 51, String(spun));
  assert.equal(timeouts.length, 1);
  assert.ok(Math.abs(timeouts[0]! - 0.95) < 0.003, String(timeouts[0]));
});
