import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobQueue, enqueueJob, drainJobs } from "../src/jobs/index.ts";

test("jobs retain their context and run only at an explicit checkpoint", () => {
  const queue = createJobQueue<{ realm: number }>();
  const context = { realm: 42 };
  let calls = 0;
  enqueueJob(
    queue,
    () => {
      calls++;
    },
    context,
  );
  assert.equal(calls, 0);
  assert.equal(queue.size, 1);
  assert.equal(
    drainJobs(queue, (job, captured) => {
      assert.equal(captured, context);
      job();
    }),
    1,
  );
  assert.equal(calls, 1);
  assert.equal(queue.size, 0);
  assert.equal(queue.head, undefined);
  assert.equal(queue.tail, undefined);
});

test("jobs added during a checkpoint follow already queued jobs", () => {
  const queue = createJobQueue<undefined>();
  const seen: number[] = [];
  enqueueJob(
    queue,
    () => {
      seen.push(1);
      enqueueJob(
        queue,
        () => {
          seen.push(3);
        },
        undefined,
      );
    },
    undefined,
  );
  enqueueJob(
    queue,
    () => {
      seen.push(2);
    },
    undefined,
  );
  assert.equal(
    drainJobs(queue, (job) => job()),
    3,
  );
  assert.deepEqual(seen, [1, 2, 3]);
});

test("nested checkpoints cannot interleave a running job", () => {
  const queue = createJobQueue<undefined>();
  const seen: number[] = [];
  enqueueJob(
    queue,
    () => {
      seen.push(1);
      assert.equal(
        drainJobs(queue, (job) => job()),
        0,
      );
      seen.push(2);
    },
    undefined,
  );
  enqueueJob(
    queue,
    () => {
      seen.push(3);
    },
    undefined,
  );
  assert.equal(
    drainJobs(queue, (job) => job()),
    2,
  );
  assert.deepEqual(seen, [1, 2, 3]);
});

test("executor errors leave remaining jobs available without replaying the failed job", () => {
  const queue = createJobQueue<number>();
  const error = {};
  let calls = 0;
  enqueueJob(
    queue,
    () => {
      calls++;
      throw error;
    },
    1,
  );
  enqueueJob(
    queue,
    () => {
      calls++;
    },
    2,
  );
  assert.throws(
    () => drainJobs(queue, (job) => job()),
    (value) => value === error,
  );
  assert.equal(queue.draining, false);
  assert.equal(queue.size, 1);
  assert.equal(
    drainJobs(queue, (job, context) => {
      assert.equal(context, 2);
      job();
    }),
    1,
  );
  assert.equal(calls, 2);
});

test("self-scheduled jobs do not grow the execution stack", () => {
  const queue = createJobQueue<number>();
  let calls = 0;
  function job(): void {
    calls++;
    if (calls < 100000) enqueueJob(queue, job, calls);
  }
  enqueueJob(queue, job, 0);
  assert.equal(
    drainJobs(queue, (entry, context) => {
      assert.equal(context, calls);
      entry();
    }),
    100000,
  );
  assert.equal(queue.size, 0);
});
