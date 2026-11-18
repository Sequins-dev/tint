import assert from "node:assert/strict";
import test from "node:test";
import { classifiedCheckTests, checkTestFiles } from "./check-test-files.ts";

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
