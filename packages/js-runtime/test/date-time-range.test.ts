import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimePartsFormatter,
  type DateTimeDisplayFields,
} from "../src/objects/date-time-parts.ts";
import {
  resolveDateTimeSkeleton,
  resolveDateTimeStylePattern,
} from "../src/objects/date-time-skeleton.ts";
import { dateTimeRangeParts } from "../src/objects/date-time-range.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
const first: DateTimeDisplayFields = {
  date: { year: 2019, month: 1, day: 3 },
  hour: 13,
  minute: 5,
  second: 9,
  millisecond: 700,
};
function range(
  skeleton: string,
  last: DateTimeDisplayFields,
  start = first,
  calendar = "gregory",
  locale = "en",
  zones: readonly (string | undefined)[] = [],
) {
  const formatter = createDateTimePartsFormatter(locale, calendar, undefined);
  assert.ok(formatter);
  const pattern = resolveDateTimeSkeleton(
    formatter.calendar,
    skeleton,
    formatter.numeric.profile.symbols.decimal,
  );
  assert.ok(pattern);
  const result = dateTimeRangeParts(
    formatter,
    pattern,
    start,
    last,
    zones[0],
    zones[1],
  );
  assert.ok(result);
  return result;
}
function text(parts: readonly { value: string }[]): string {
  return parts.map((part) => part.value).join("");
}
test("compact date intervals tag shared month/year and separate endpoint days", () => {
  const result = range("yMMMd", {
    ...first,
    date: { year: 2019, month: 1, day: 5 },
  });
  assert.equal(text(result), "Jan 3\u2009–\u20095, 2019");
  assert.deepEqual(result, [
    { type: "month", value: "Jan", source: "shared" },
    { type: "literal", value: " ", source: "shared" },
    { type: "day", value: "3", source: "startRange" },
    { type: "literal", value: "\u2009–\u2009", source: "shared" },
    { type: "day", value: "5", source: "endRange" },
    { type: "literal", value: ", ", source: "shared" },
    { type: "year", value: "2019", source: "shared" },
  ]);
  const months = range("yMMMd", {
    ...first,
    date: { year: 2019, month: 3, day: 4 },
  });
  assert.equal(text(months), "Jan 3\u2009–\u2009Mar 4, 2019");
  assert.equal(months.find((part) => part.type === "year")?.source, "shared");
  const years = range("yMMMd", {
    ...first,
    date: { year: 2020, month: 3, day: 4 },
  });
  assert.equal(text(years), "Jan 3, 2019\u2009–\u2009Mar 4, 2020");
  assert.ok(
    years
      .filter((part) => part.type === "year")
      .every((part) => part.source !== "shared"),
  );
});
test("calendar precision collapses ignored time differences and permits reverse arguments", () => {
  const same = range("yMd", { ...first, hour: 23, millisecond: 999 });
  assert.equal(text(same), "1/3/2019");
  assert.ok(same.every((part) => part.source === "shared"));
  const reverse = range("yMMMd", first, {
    ...first,
    date: { year: 2019, month: 1, day: 5 },
  });
  assert.equal(text(reverse), "Jan 5\u2009–\u20093, 2019");
});
test("same-day date/time intervals retain the original connector and share the date", () => {
  const last = { ...first, hour: 14, minute: 6 };
  const result = range("yMMMdHm", last);
  assert.equal(text(result), "Jan 3, 2019, 13:05\u2009–\u200914:06");
  assert.ok(
    result
      .filter((part) => ["month", "day", "year"].includes(part.type))
      .every((part) => part.source === "shared"),
  );
  const formatter = createDateTimePartsFormatter("en", "gregory", undefined)!,
    pattern = resolveDateTimeStylePattern(
      formatter.calendar,
      "long",
      "short",
      "h12",
    )!;
  const styled = dateTimeRangeParts(
    formatter,
    pattern,
    first,
    last,
    undefined,
    undefined,
  );
  assert.ok(styled);
  assert.ok(text(styled).includes(" at "));
  assert.equal(
    styled.find((part) => part.type === "dayPeriod")?.source,
    "shared",
  );
});
test("higher calendar fields prevent collapsing equal time-only displays", () => {
  const result = range("H", {
    ...first,
    date: { year: 2019, month: 1, day: 5 },
  });
  assert.equal(text(result), "13\u2009–\u200913");
  assert.deepEqual(
    result.filter((part) => part.type === "hour").map((part) => part.source),
    ["startRange", "endRange"],
  );
});
test("fractional precision uses truncation and a full endpoint fallback when it differs", () => {
  const same = range("msSS", { ...first, millisecond: 709 });
  assert.equal(text(same), "05:09.70");
  assert.ok(same.every((part) => part.source === "shared"));
  const different = range("msSS", { ...first, millisecond: 710 });
  assert.equal(text(different), "05:09.70\u2009–\u200905:09.71");
  assert.equal(
    different.filter((part) => part.type === "fractionalSecond").length,
    2,
  );
  const combined = range("yMMMdmsSS", { ...first, millisecond: 710 });
  assert.equal(text(combined), "Jan 3, 2019, 05:09.70\u2009–\u200905:09.71");
  assert.ok(
    combined
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .every((part) => part.source === "shared"),
  );
});
test("flexible day-period comparisons ignore hidden clock fields at matching precision", () => {
  const morning = { ...first, hour: 1 };
  const same = range("BBBB", { ...morning, hour: 8 }, morning);
  assert.ok(same.every((part) => part.source === "shared"));
  const different = range(
    "BBBB",
    { ...first, hour: 15 },
    { ...first, hour: 8 },
  );
  assert.equal(text(different), "in the morning\u2009–\u2009in the afternoon");
});
test("a singleton field that changes cannot be incorrectly marked shared", () => {
  const result = range("hmz", { ...first, hour: 14 }, first, "gregory", "en", [
    "PDT",
    "PST",
  ]);
  assert.deepEqual(
    result
      .filter((part) => part.type === "timeZoneName")
      .map((part) => [part.value, part.source]),
    [
      ["PDT", "startRange"],
      ["PST", "endRange"],
    ],
  );
});
test("lunisolar intervals preserve leap months and each CLDR year form", () => {
  const start = { ...first, date: { year: 2020, month: 5, day: 23 } },
    last = { ...first, date: { year: 2020, month: 5, day: 24 } };
  const result = range("yMMMMd", last, start, "chinese", "zh");
  assert.ok(
    result.some((part) => part.type === "month" && part.value.includes("闰")),
  );
  assert.equal(
    result.find((part) => part.type === "relatedYear")?.source,
    "shared",
  );
  // The compact yMMMd interval intentionally uses r alone; the weekday form
  // carries both related and cyclic years in the pinned CLDR data.
  assert.equal(
    result.find((part) => part.type === "yearName"),
    undefined,
  );
  const weekdays = range("yMMMMEd", last, start, "chinese", "zh");
  assert.equal(
    weekdays.find((part) => part.type === "yearName")?.source,
    "shared",
  );
});
test("interval sources and same-value collapse cover every supported locale", () => {
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|"));
    for (const skeleton of ["yMMMd", "yMMMdHm"]) {
      const last = {
        ...first,
        date: { year: 2019, month: 1, day: 5 },
        hour: 14,
        minute: 6,
      };
      const result = range(skeleton, last, first, "gregory", locale);
      assert.ok(result.length > 0, locale + "/" + skeleton);
      assert.ok(
        result.every((part) =>
          ["shared", "startRange", "endRange"].includes(part.source),
        ),
        locale + "/" + skeleton,
      );
      const same = range(skeleton, first, first, "gregory", locale);
      assert.ok(
        same.every((part) => part.source === "shared"),
        locale + "/collapse/" + skeleton,
      );
    }
  }
});
