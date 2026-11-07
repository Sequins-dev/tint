import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimePartsFormatter,
  dateTimePatternParts,
  type DateTimeDisplayFields,
} from "../src/objects/date-time-parts.ts";
import { parseDateTimePattern } from "../src/objects/date-time-pattern.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
const sample: DateTimeDisplayFields = {
  date: { year: 2024, month: 2, day: 29 },
  hour: 13,
  minute: 5,
  second: 9,
  millisecond: 7,
};
function parts(
  locale: string,
  calendar: string,
  pattern: string,
  input = sample,
  numberingSystem: string | undefined = undefined,
  zoneName: string | undefined = undefined,
) {
  const formatter = createDateTimePartsFormatter(
    locale,
    calendar,
    numberingSystem,
  );
  assert.ok(formatter);
  const tokens = parseDateTimePattern(pattern);
  assert.ok(tokens);
  const result = dateTimePatternParts(formatter, tokens, input, zoneName);
  assert.ok(result);
  return result;
}
function field(
  values: readonly { type: string; value: string }[],
  name: string,
): string | undefined {
  return values.find((part) => part.type === name)?.value;
}
test("date parts combine private numeric formatting, names and literal quoting", () => {
  const values = parts("en", "gregory", "EEEE, MMMM d, y 'at' h:mm:ss.SSS a");
  assert.equal(
    values.map((part) => part.value).join(""),
    "Thursday, February 29, 2024 at 1:05:09.007 PM",
  );
  assert.equal(field(values, "fractionalSecond"), "007");
  assert.equal(field(parts("en", "gregory", "EEEEEE"), "weekday"), "Th");
  assert.equal(
    field(parts("en", "gregory", "K k", { ...sample, hour: 0 }), "hour"),
    "0",
  );
  assert.equal(
    parts("en", "gregory", "k", { ...sample, hour: 0 })[0]?.value,
    "24",
  );
});
test("calendar numbers respect positional and astral digits without UTF16 truncation", () => {
  assert.equal(
    field(parts("ar", "gregory", "HH", sample, "arab"), "hour"),
    "١٣",
  );
  assert.equal(
    field(parts("en", "gregory", "yy", sample, "mathbold"), "year"),
    "𝟐𝟒",
  );
  assert.equal(
    field(
      parts("en", "gregory", "SSS", sample, "mathbold"),
      "fractionalSecond",
    ),
    "𝟎𝟎𝟕",
  );
});
test("calendar month identities retain lunisolar leap labels and cyclic year parts", () => {
  const chinese = parts("zh", "chinese", "r U MMMM d", {
    ...sample,
    date: { year: 2020, month: 5, day: 23 },
  });
  assert.equal(field(chinese, "relatedYear"), "2020");
  assert.equal(field(chinese, "yearName"), "庚子");
  assert.equal(field(chinese, "month"), "闰四月");
  assert.equal(field(chinese, "day"), "1");
  for (const [date, expected] of [
    [{ year: 2024, month: 2, day: 15 }, "Adar I"],
    [{ year: 2024, month: 3, day: 15 }, "Adar II"],
    [{ year: 2023, month: 3, day: 15 }, "Adar"],
  ] as const)
    assert.equal(
      field(parts("en", "hebrew", "MMMM", { ...sample, date }), "month"),
      expected,
    );
});
test("lunisolar labels and day periods render across every supported locale", () => {
  const tokens = parseDateTimePattern("MMMMM EEEEE BBBBB")!;
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|"));
    for (const calendar of ["hebrew", "chinese", "dangi"]) {
      const formatter = createDateTimePartsFormatter(
        locale,
        calendar,
        undefined,
      );
      assert.ok(formatter, locale + "/" + calendar);
      const input = {
        ...sample,
        date:
          calendar === "hebrew"
            ? { year: 2024, month: 3, day: 15 }
            : { year: 2020, month: 5, day: 23 },
      };
      const values = dateTimePatternParts(formatter, tokens, input, undefined);
      assert.ok(values, locale + "/" + calendar);
      assert.ok(field(values, "month"), locale + "/" + calendar + "/month");
      assert.ok(field(values, "weekday"), locale + "/" + calendar + "/weekday");
      assert.ok(
        field(values, "dayPeriod"),
        locale + "/" + calendar + "/dayPeriod",
      );
    }
  }
});
test("era and era-year display cover BCE, modern Japanese and single-era calendars", () => {
  const bce = parts("en", "gregory", "G y", {
    ...sample,
    date: { year: 0, month: 1, day: 1 },
  });
  assert.equal(field(bce, "era"), "BC");
  assert.equal(field(bce, "year"), "1");
  const japanese = parts("en", "japanese", "GGGG y", {
    ...sample,
    date: { year: 2020, month: 1, day: 1 },
  });
  assert.equal(field(japanese, "era"), "Reiwa");
  assert.equal(field(japanese, "year"), "2");
  const islamic = [600, 2025].map((year) =>
    field(
      parts("en", "islamic-civil", "GGGG y", {
        ...sample,
        date: { year, month: 6, day: 15 },
      }),
      "era",
    ),
  );
  assert.ok(islamic[0]);
  assert.ok(islamic[1]);
  assert.notEqual(islamic[0], islamic[1]);
  const ethiopic = [-6000, 0, 2025].map((year) =>
    field(
      parts("en", "ethiopic", "GGGG y", {
        ...sample,
        date: { year, month: 6, day: 15 },
      }),
      "era",
    ),
  );
  assert.equal(ethiopic[0], ethiopic[1]);
  assert.notEqual(ethiopic[0], ethiopic[2]);
  assert.equal(
    field(
      parts("en", "chinese", "G r", {
        ...sample,
        date: { year: 2020, month: 5, day: 23 },
      }),
      "era",
    ),
    undefined,
  );
});
test("day periods distinguish exact noon, flexible ranges and explicit zone-name context", () => {
  assert.equal(
    field(
      parts("en", "gregory", "BBBB", {
        ...sample,
        hour: 12,
        minute: 0,
        second: 0,
        millisecond: 0,
      }),
      "dayPeriod",
    ),
    "noon",
  );
  assert.equal(
    field(
      parts("en", "gregory", "BBBB", {
        ...sample,
        hour: 12,
        minute: 0,
        second: 1,
        millisecond: 0,
      }),
      "dayPeriod",
    ),
    "in the afternoon",
  );
  assert.equal(
    field(
      parts("en", "gregory", "b", {
        ...sample,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      }),
      "dayPeriod",
    ),
    "midnight",
  );
  assert.equal(
    field(
      parts("en", "gregory", "z", sample, undefined, "PDT"),
      "timeZoneName",
    ),
    "PDT",
  );
});
test("invalid coordinates and unavailable pattern context remain explicit", () => {
  const formatter = createDateTimePartsFormatter("en", "gregory", undefined)!;
  assert.equal(
    dateTimePatternParts(
      formatter,
      parseDateTimePattern("yMd")!,
      { ...sample, date: { year: 2024, month: 2, day: 30 } },
      undefined,
    ),
    undefined,
  );
  assert.equal(
    dateTimePatternParts(
      formatter,
      parseDateTimePattern("s")!,
      { ...sample, second: 60 },
      undefined,
    ),
    undefined,
  );
  assert.equal(
    dateTimePatternParts(
      formatter,
      parseDateTimePattern("Q")!,
      sample,
      undefined,
    ),
    undefined,
  );
  assert.equal(
    dateTimePatternParts(
      formatter,
      parseDateTimePattern("z")!,
      sample,
      undefined,
    ),
    undefined,
  );
});
