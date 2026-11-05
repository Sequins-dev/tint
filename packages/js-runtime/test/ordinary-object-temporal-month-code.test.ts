import assert from "node:assert/strict";
import test from "node:test";
import * as codes from "../src/objects/temporal-month-code.ts";
test("month code syntax is independent of calendar-specific month availability", () => {
  assert.equal(typeof codes.parseMonthCodeText, "function");
  for (const [text, month, leap] of [
    ["M01", 1, false],
    ["M12", 12, false],
    ["M99", 99, false],
    ["M99L", 99, true],
    ["M00L", 0, true],
  ] as const)
    assert.deepEqual(codes.parseMonthCodeText(text), { month, leap });
  for (const text of [
    "M00",
    "M000",
    "m01",
    "M1",
    "M01l",
    "M001L",
    "M 1",
    "M-1",
  ])
    assert.equal(codes.parseMonthCodeText(text), undefined);
});
