import assert from "node:assert/strict";
import test from "node:test";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";
import {
  addDurations,
  compareDurations,
} from "../src/objects/temporal-duration-arithmetic.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function d(fields: readonly number[]) {
  const value = createDuration(fields);
  assert.ok(value);
  return value;
}
test("duration sums balance from the largest input unit and preserve exact carries", () => {
  const result = addDurations(
    d([0, 0, 0, 1, 23]),
    d([0, 0, 0, 0, 2]),
    false,
    realm,
  );
  assert.deepEqual([result.days, result.hours], [2, 1]);
  const hours = addDurations(
    d([0, 0, 0, 0, 23]),
    d([0, 0, 0, 0, 2]),
    false,
    realm,
  );
  assert.deepEqual([hours.days, hours.hours], [0, 25]);
  const cancel = addDurations(
    d([0, 0, 0, 1]),
    d([0, 0, 0, 0, 25]),
    true,
    realm,
  );
  assert.deepEqual([cancel.days, cancel.hours], [0, -1]);
  assert.throws(() => addDurations(d([1]), d([]), false, realm));
});

test("duration comparisons preserve differences below binary64 precision", () => {
  const a = d([0, 0, 0, 0, 0, 0, 0, 0, 18446744073709552, 616]),
    b = d([0, 0, 0, 0, 0, 0, 0, 0, 18446744073709552, 617]);
  assert.equal(compareDurations(a, b, { kind: "none" }, realm), -1);
  assert.equal(
    compareDurations(
      d([1]),
      d([0, 0, 0, 366]),
      { kind: "plain", date: { year: 2020, month: 1, day: 1 } },
      realm,
    ),
    0,
  );
  assert.equal(compareDurations(d([1]), d([1]), { kind: "none" }, realm), 0);
});
