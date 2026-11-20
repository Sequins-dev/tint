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
