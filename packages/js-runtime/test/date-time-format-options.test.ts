import assert from "node:assert/strict";
import test from "node:test";
import {
  dateTimePatternFields,
  parseDateTimePattern,
} from "../src/objects/date-time-pattern.ts";
import { resolveDateTimeFormatOptions } from "../src/objects/date-time-format-options.ts";
function fields(skeleton = "") {
  const result = dateTimePatternFields(parseDateTimePattern(skeleton)!);
  assert.ok(result);
  return result;
}
function resolve(
  skeleton: string,
  required: string,
  defaults = required,
  inheritAll = false,
) {
  return resolveDateTimeFormatOptions(
    fields(skeleton),
    required,
    defaults,
    inheritAll,
  );
}
test("each Temporal model receives only its own defaults", () => {
  for (const [kind, names] of [
    ["date", ["year", "month", "day"]],
    ["year-month", ["year", "month"]],
    ["month-day", ["month", "day"]],
    ["time", ["hour", "minute", "second"]],
    ["any", ["year", "month", "day", "hour", "minute", "second"]],
  ] as const) {
    const raw = fields(),
      result = resolveDateTimeFormatOptions(
        raw,
        kind,
        kind === "any" ? "all" : kind,
        false,
      );
    assert.ok(result);
    assert.deepEqual(
      Object.entries(result)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k)
        .sort(),
      [...names].sort(),
    );
    assert.deepEqual(raw, fields());
  }
});
test("explicit components with no overlap reject rather than acquiring defaults", () => {
  for (const [skeleton, kind] of [
    ["H", "date"],
    ["y", "time"],
    ["d", "year-month"],
    ["y", "month-day"],
    ["E", "year-month"],
  ])
    assert.equal(resolve(skeleton!, kind!), undefined);
  const month = resolve("MH", "date");
  assert.ok(month);
  assert.equal(month.month, "numeric");
  assert.equal(month.hour, undefined);
  assert.equal(month.year, undefined);
});
test("era and time-zone names do not prevent model defaults", () => {
  const date = resolve("Gz", "date");
  assert.ok(date);
  assert.equal(date.era, "short");
  assert.equal(date.year, "numeric");
  assert.equal(date.timeZoneName, undefined);
  const time = resolve("Gz", "time");
  assert.ok(time);
  assert.equal(time.era, undefined);
  assert.equal(time.hour, "numeric");
  assert.equal(time.timeZoneName, undefined);
  const monthDay = resolve("G", "month-day");
  assert.ok(monthDay);
  assert.equal(monthDay.era, undefined);
  assert.equal(monthDay.day, "numeric");
});
test("all inheritance preserves unrelated explicit fields while adding required defaults", () => {
  const date = resolve("H", "date", "date", true);
  assert.ok(date);
  assert.equal(date.year, "numeric");
  assert.equal(date.hour, "numeric");
  const publicFormat = resolve("m", "any", "date", true);
  assert.ok(publicFormat);
  assert.equal(publicFormat.year, undefined);
  assert.equal(publicFormat.minute, "numeric");
});
test("zoned defaults add a short zone name only when defaults are needed", () => {
  const zoned = resolve("", "any", "zoned-date-time", true);
  assert.ok(zoned);
  assert.equal(zoned.timeZoneName, "short");
  assert.equal(zoned.second, "numeric");
  const explicit = resolve("y", "any", "zoned-date-time", true);
  assert.ok(explicit);
  assert.equal(explicit.timeZoneName, undefined);
  assert.equal(explicit.hour, undefined);
});
