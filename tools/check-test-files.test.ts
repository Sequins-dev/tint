import assert from "node:assert/strict";
import test from "node:test";
import {
  checkTestArguments,
  classifiedCheckTests,
  checkTestFiles,
  nativeTestConcurrency,
} from "./check-test-files.ts";

test("every workspace check test has exactly one resource classification", () => {
  const files = checkTestFiles();
  const { concurrent, exclusive } = classifiedCheckTests(files);
  assert.deepEqual([...concurrent, ...exclusive].sort(), files);
});

test("the check rejects an unclassified file before starting any test", () => {
  assert.throws(
    () => classifiedCheckTests([...checkTestFiles(), "tools/new-test.test.ts"]),
    /unclassified.*tools\/new-test\.test\.ts/i,
  );
});

test("native and standalone exclusive checks pass the configured Node test concurrency", () => {
  const { native, exclusive, memory, concurrent } = classifiedCheckTests();
  assert.deepEqual(checkTestArguments("native", "2"), [
    "--test",
    "--test-concurrency=2",
    ...native,
  ]);
  assert.deepEqual(checkTestArguments("exclusive", "4"), [
    "--test",
    "--test-concurrency=4",
    ...exclusive,
  ]);
  assert.deepEqual(checkTestArguments("memory", "2"), ["--test", ...memory]);
  assert.deepEqual(checkTestArguments("concurrent", "2"), [
    "--test",
    ...concurrent,
  ]);
});

test("native concurrency defaults to two and rejects invalid overrides", () => {
  assert.equal(nativeTestConcurrency(undefined), "2");
  for (const value of ["", "0", "-1", "1.5", " 2", "9007199254740992"]) {
    assert.throws(
      () => nativeTestConcurrency(value),
      /TINT_GATE_NATIVE_CONCURRENCY/,
    );
  }
});
