import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeSelectionObservations } from "./native-selection-observations.ts";
import type {
  NativeObservation,
  NativeObservationInput,
} from "./native-run-journal.ts";
const input = (variant: "sloppy" | "strict"): NativeObservationInput => ({
  path: "built-ins/Example/test.js",
  variant,
  sha256: "a".repeat(64),
  metadata: { flags: [], features: [], includes: [] },
  canSuspend: true,
  harness: [{ name: "assert.js", sha256: "b".repeat(64) }],
});
const first: NativeObservation = {
  ...input("sloppy"),
  elapsedMs: 1,
  status: "pass",
  outcome: { kind: "completed" },
};
const second: NativeObservation = {
  ...input("strict"),
  elapsedMs: 2,
  status: "crash",
  outcome: { kind: "crash", detail: "retained pre-entry failure" },
};
test("a complete family extraction preserves failures and the pinned variant order", () => {
  const unrelated = { ...first, path: "elsewhere.js" };
  assert.deepEqual(
    nativeSelectionObservations(
      [second, unrelated, first],
      [input("sloppy"), input("strict")],
    ),
    [first, second],
  );
});
test("family extraction refuses missing, duplicate, changed and inconsistent observations", () => {
  const expected = [input("sloppy"), input("strict")];
  for (const rows of [
    [first],
    [first, first, second],
    [first, { ...second, sha256: "c".repeat(64) }],
    [first, { ...second, harness: [] }],
    [first, { ...second, status: "pass" as const }],
  ])
    assert.throws(() => nativeSelectionObservations(rows, expected));
  assert.throws(() => nativeSelectionObservations([], []));
  assert.throws(() =>
    nativeSelectionObservations([first], [input("sloppy"), input("sloppy")]),
  );
});
