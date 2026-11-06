import assert from "node:assert/strict";
import test from "node:test";
import { nativeSelectionOrder } from "./native-selection-order.ts";

test("native selection groups syntax negatives without changing either lane's order", () => {
  const files = [
    { path: "positive-a.js", metadata: {} },
    { path: "parse.js", metadata: { negative: { phase: "parse" } } },
    {
      path: "runtime-negative.js",
      metadata: { negative: { phase: "runtime" } },
    },
    { path: "early.js", metadata: { negative: { phase: "early" } } },
    {
      path: "resolution-negative.js",
      metadata: { negative: { phase: "resolution" } },
    },
    { path: "positive-b.js", metadata: {} },
  ];
  const original = [...files];
  const ordered = nativeSelectionOrder(files);
  assert.deepEqual(
    ordered.map((file) => file.path),
    [
      "parse.js",
      "early.js",
      "positive-a.js",
      "runtime-negative.js",
      "resolution-negative.js",
      "positive-b.js",
    ],
  );
  assert.deepEqual(files, original);
  assert.equal(new Set(ordered).size, files.length);
  // Alternating source names previously forced five compiler invocations even
  // with room in each batch; grouping the same cases requires only two lanes.
  const transitions = (items: typeof files) =>
    items.reduce((count, file, index) => {
      const syntax = (item: typeof file) =>
        ["parse", "early"].includes(item.metadata.negative?.phase ?? "");
      return (
        count +
        (index === 0 || syntax(file) !== syntax(items[index - 1]!) ? 1 : 0)
      );
    }, 0);
  assert.equal(transitions(files), 5);
  assert.equal(transitions(ordered), 2);
});
