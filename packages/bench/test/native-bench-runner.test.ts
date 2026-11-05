import { test } from "node:test";
import assert from "node:assert/strict";
import { bench, suite, runBenchmarks } from "../src/native.ts";
test("native facade collects declarations before serial execution", () => {
  let prepared = false,
    tick = 0;
  const names: string[] = [];
  suite("group", () => {
    bench("first", { warmup: 1, samples: 2 }, (b) => {
      assert.ok(prepared);
      b.start();
      tick++;
      b.end(1);
    });
    bench("second", { warmup: 0, samples: 1 }, (b) => {
      b.start();
      tick += 2;
      b.end(2);
    });
  });
  prepared = true;
  assert.equal(
    runBenchmarks(
      () => tick,
      (r) => {
        names.push(r.name);
        assert.ok(r.samples.length > 0);
      },
    ),
    2,
  );
  assert.deepEqual(names, ["group > first", "group > second"]);
  assert.throws(() =>
    runBenchmarks(
      () => tick,
      () => {},
    ),
  );
  assert.throws(() => bench("late", {}, () => {}));
});
