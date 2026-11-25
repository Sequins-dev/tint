import assert from "node:assert/strict";
import test from "node:test";
import {
  checkTestArguments,
  classifiedCheckTests,
  checkTestFiles,
  nativeTestConcurrency,
  parseCheckTestShard,
  shardCheckTests,
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

test("shards partition a group: every file runs in exactly one shard", () => {
  const { native, memory } = classifiedCheckTests();
  for (const group of [native, memory])
    for (let count = 1; count <= 4; count++) {
      const shards = Array.from({ length: count }, (_, index) =>
        shardCheckTests(group, { index: index + 1, count }),
      );
      assert.deepEqual(shards.flat().sort(), [...group].sort());
      for (const shard of shards) assert.ok(shard.length > 0);
    }
});

test("shards balance measured costs, heaviest files first", () => {
  const files = ["a", "b", "c", "d", "e"];
  const costs = { a: 10, b: 7, c: 6, d: 4 };
  // e has no cost and weighs the median recorded cost, 7: a | b, e | c to
  // the lighter first shard | d to the lighter second (16 against 14).
  assert.deepEqual(shardCheckTests(files, { index: 1, count: 2 }, costs), [
    "a",
    "c",
  ]);
  assert.deepEqual(shardCheckTests(files, { index: 2, count: 2 }, costs), [
    "b",
    "e",
    "d",
  ]);
  assert.deepEqual(
    checkTestArguments("native", "2", { index: 1, count: 1 }),
    checkTestArguments("native", "2")
      .slice(0, 2)
      .concat(
        shardCheckTests(classifiedCheckTests().native, { index: 1, count: 1 }),
      ),
  );
});

test("shard arguments are INDEX/COUNT with 1 <= INDEX <= COUNT", () => {
  assert.deepEqual(parseCheckTestShard("2/3"), { index: 2, count: 3 });
  for (const value of ["0/3", "4/3", "1", "1/0", "a/b", "1/3/2", " 1/3"])
    assert.throws(() => parseCheckTestShard(value), /INDEX\/COUNT/);
});

test("shard costs count a file's image work, or its wall time without images", async () => {
  const { nativeFileCosts } = await import("./gate/native-costs.ts");
  const line = (event: object) => JSON.stringify(event);
  const journal = [
    line({ phase: "worker-start", worker: 1, file: "a.test.ts", at: 0 }),
    line({ phase: "worker-start", worker: 2, file: "b.test.ts", at: 0 }),
    line({ phase: "memory-wait", worker: 1, elapsedMs: 90_000 }),
    line({ phase: "build", worker: 1, elapsedMs: 20_000 }),
    line({ phase: "lock-wait", worker: 1, elapsedMs: 50_000 }),
    line({ phase: "admission", worker: 1, elapsedMs: 3_000 }),
    line({ phase: "execution", worker: 1, elapsedMs: 4_400 }),
    line({ phase: "worker-end", worker: 1, at: 200_000 }),
    line({ phase: "worker-end", worker: 2, at: 12_000 }),
  ].join("\n");
  assert.deepEqual(
    nativeFileCosts([journal]),
    new Map([
      ["a.test.ts", 27],
      ["b.test.ts", 12],
    ]),
  );
});
