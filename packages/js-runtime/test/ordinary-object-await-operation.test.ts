import assert from "node:assert/strict";
import test from "node:test";
import * as awaiting from "../src/objects/await.ts";

// A compiler-owned operation resumes from an existing async job; it is not a
// JavaScript Promise and must not add another Promise reaction job.
test("native await operations resume in the job that completes their work", () => {
  const capability = awaiting.createNativeAwaitOperation();
  const operation =
    capability.value.internalExoticSlots?.internalAwaitOperation;
  assert.ok(operation);
  const log: unknown[] = [];
  operation.subscribe(
    (value) => log.push(value),
    (error) => log.push(error),
  );
  log.push("before");
  capability.resolve(42);
  log.push("after");
  capability.reject(19);
  assert.deepEqual(log, ["before", 42, "after"]);
});

test("native await operations preserve settled rejection including undefined", () => {
  const capability = awaiting.createNativeAwaitOperation();
  capability.reject(undefined);
  const operation =
    capability.value.internalExoticSlots?.internalAwaitOperation;
  assert.ok(operation);
  let rejected = false;
  operation.subscribe(
    () => assert.fail("unexpected fulfillment"),
    (error) => {
      rejected = true;
      assert.equal(error, undefined);
    },
  );
  assert.equal(rejected, true);
  assert.equal(
    capability.value.internalExoticSlots?.internalPromiseData,
    undefined,
  );
});
