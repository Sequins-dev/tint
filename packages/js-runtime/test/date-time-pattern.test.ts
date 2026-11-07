import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDateTimePattern,
  dateTimePatternFields,
  basicDateTimeFormatScore,
  selectBasicDateTimeFormat,
  splitDateTimeIntervalPattern,
} from "../src/objects/date-time-pattern.ts";

const pattern = (text: string) => {
  const tokens = parseDateTimePattern(text);
  assert.ok(tokens);
  const fields = dateTimePatternFields(tokens);
  assert.ok(fields);
  return { pattern: text, fields };
};
test("LDML pattern parsing preserves quoted text, apostrophes and Unicode literals", () => {
  assert.deepEqual(
    parseDateTimePattern("yyyy-MM-dd 'at' HH:mm 'o''clock' 🌙"),
    [
      { literal: "", symbol: "y", width: 4 },
      { literal: "-", symbol: "", width: 0 },
      { literal: "", symbol: "M", width: 2 },
      { literal: "-", symbol: "", width: 0 },
      { literal: "", symbol: "d", width: 2 },
      { literal: " at ", symbol: "", width: 0 },
      { literal: "", symbol: "H", width: 2 },
      { literal: ":", symbol: "", width: 0 },
      { literal: "", symbol: "m", width: 2 },
      { literal: " o'clock 🌙", symbol: "", width: 0 },
    ],
  );
  assert.deepEqual(parseDateTimePattern("''h''"), [
    { literal: "'", symbol: "", width: 0 },
    { literal: "", symbol: "h", width: 1 },
    { literal: "'", symbol: "", width: 0 },
  ]);
  assert.equal(parseDateTimePattern("y 'unfinished"), undefined);
});
test("date pattern descriptors distinguish implicit AM/PM from flexible day periods", () => {
  const fields = pattern("EEEE, MMMM d, yy GGGGG h:mm:ss.SSS a zzzz").fields;
  assert.equal(fields.weekday, "long");
  assert.equal(fields.month, "long");
  assert.equal(fields.year, "2-digit");
  assert.equal(fields.era, "narrow");
  assert.equal(fields.dayPeriod, undefined);
  assert.equal(fields.hour, "numeric");
  assert.equal(fields.minute, "2-digit");
  assert.equal(fields.fractionalSecondDigits, 3);
  assert.equal(fields.timeZoneName, "long");
  assert.equal(pattern("h BBBBB").fields.dayPeriod, "narrow");
  assert.equal(
    dateTimePatternFields(parseDateTimePattern("yyyy QQQ")!),
    undefined,
  );
});
test("basic format matching weighs missing fields more than extra fields and retains first ties", () => {
  const requested = pattern("yMd").fields,
    exact = pattern("M/d/y"),
    extra = pattern("E M/d/y"),
    missing = pattern("M/y");
  assert.equal(basicDateTimeFormatScore(requested, exact.fields), 0);
  assert.equal(basicDateTimeFormatScore(requested, extra.fields), -20);
  assert.equal(basicDateTimeFormatScore(requested, missing.fields), -120);
  assert.equal(
    selectBasicDateTimeFormat(requested, [missing, extra, exact]),
    exact,
  );
  assert.equal(
    selectBasicDateTimeFormat(requested, [exact, pattern("d.M.y")]),
    exact,
  );
  assert.equal(selectBasicDateTimeFormat(requested, []), undefined);
});
test("basic matcher applies asymmetric field-width and fractional precision penalties", () => {
  assert.equal(
    basicDateTimeFormatScore(pattern("MMMM").fields, pattern("MMM").fields),
    -6,
  );
  assert.equal(
    basicDateTimeFormatScore(pattern("MMM").fields, pattern("MMMM").fields),
    -3,
  );
  assert.equal(
    basicDateTimeFormatScore(pattern("MMMM").fields, pattern("M").fields),
    -8,
  );
  assert.equal(
    basicDateTimeFormatScore(pattern("M").fields, pattern("MMMM").fields),
    -6,
  );
  assert.equal(
    basicDateTimeFormatScore(pattern("SSS").fields, pattern("S").fields),
    -8,
  );
});
test("basic matcher prefers sanctioned time-zone offset fallbacks", () => {
  for (const [requested, offered, penalty] of [
    ["z", "O", 1],
    ["z", "OOOO", 4],
    ["zzzz", "O", 9],
    ["zzzz", "OOOO", 1],
    ["v", "vvvv", 3],
    ["vvvv", "v", 8],
    ["O", "OOOO", 3],
    ["OOOO", "O", 8],
    ["z", "v", 120],
  ] as const)
    assert.equal(
      basicDateTimeFormatScore(
        pattern(requested).fields,
        pattern(offered).fields,
      ),
      -penalty,
    );
});
test("interval splitting recognizes repeated fields without conflating related and cyclic years", () => {
  const tokens = parseDateTimePattern("r(U) MMM d–d, y")!;
  const split = splitDateTimeIntervalPattern(tokens);
  assert.ok(split);
  assert.equal(split.field, "day");
  assert.deepEqual(split.first, tokens.slice(0, 8));
  assert.deepEqual(split.second, tokens.slice(8));
  assert.equal(
    splitDateTimeIntervalPattern(parseDateTimePattern("MMM d, y")!),
    undefined,
  );
});
