import assert from "node:assert/strict";
import test from "node:test";
import { createDateTimeCalendarProfile } from "../src/objects/date-time-calendar.ts";
import {
  resolveDateTimeSkeleton,
  resolveDateTimeStylePattern,
  combineDateTimePatterns,
} from "../src/objects/date-time-skeleton.ts";
import { parseDateTimePattern } from "../src/objects/date-time-pattern.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
function resolve(
  locale: string,
  skeleton: string,
  calendar = "gregory",
  decimal = ".",
) {
  const profile = createDateTimeCalendarProfile(locale, calendar);
  assert.ok(profile);
  const result = resolveDateTimeSkeleton(profile, skeleton, decimal);
  assert.ok(result, skeleton);
  return result;
}
function text(
  tokens: readonly { symbol: string; width: number; literal: string }[],
): string {
  return tokens
    .map((token) =>
      token.symbol === "" ? token.literal : token.symbol.repeat(token.width),
    )
    .join("");
}
test("skeleton matching adjusts text widths while retaining locale numeric overrides", () => {
  assert.equal(text(resolve("en", "yMMMMd").tokens), "MMMM d, y");
  assert.equal(resolve("ja", "yMMMM").fields.month, "numeric");
  assert.equal(resolve("he", "MMMEd", "hebrew").fields.month, "long");
  assert.equal(text(resolve("zh", "y", "chinese").tokens), "rU年");
  assert.equal(resolve("en", "y", "japanese").fields.era, "short");
  assert.equal(text(resolve("ksh", "yM").tokens), "y-MM");
});
test("date and time skeletons combine without adding unrequested fields", () => {
  const result = resolve("en", "yMdHm");
  assert.equal(text(result.tokens), "M/d/y, HH:mm");
  assert.equal(result.fields.year, "numeric");
  assert.equal(result.fields.hour, "2-digit");
  assert.equal(result.fields.second, undefined);
  assert.equal(result.fields.era, undefined);
  assert.equal(text(result.dateTokens!), "M/d/y");
  assert.equal(text(result.timeTokens!), "HH:mm");
  assert.equal(result.connector, "{1}, {0}");
  assert.equal(result.timeSlot, 0);
  assert.equal(text(resolve("en", "yMdzzzz").tokens), "M/d/y zzzz");
  const period = resolve("en", "BBBB");
  assert.equal(text(period.tokens), "BBBB");
  assert.equal(period.fields.hour, undefined);
});
test("required component subsets resolve across the complete locale registry", () => {
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|"));
    for (const skeleton of [
      "EEEEyMdHms",
      "EEEEyMd",
      "yMd",
      "yM",
      "Md",
      "Hms",
      "Hm",
    ]) {
      const result = resolve(locale, skeleton);
      const requested = parseDateTimePattern(skeleton)!;
      assert.ok(result.tokens.length > 0);
      for (const field of [
        "year",
        "month",
        "day",
        "weekday",
        "hour",
        "minute",
        "second",
      ] as const) {
        const symbols =
          field === "year"
            ? "y"
            : field === "month"
              ? "M"
              : field === "day"
                ? "d"
                : field === "weekday"
                  ? "E"
                  : field === "hour"
                    ? "H"
                    : field === "minute"
                      ? "m"
                      : "s";
        assert.equal(
          result.fields[field] !== undefined,
          requested.some((item) => item.symbol === symbols),
          locale + "/" + skeleton + "/" + field,
        );
      }
    }
  }
});
test("fractional seconds use the supplied decimal separator and preserve time widths", () => {
  const result = resolve("fr", "HmsSSS", "gregory", ",");
  assert.equal(text(result.tokens), "HH:mm:ss,SSS");
  assert.equal(result.fields.fractionalSecondDigits, 3);
  assert.equal(text(resolve("en", "SS").tokens), "SS");
  const appended = resolve("en", "hsSS");
  assert.equal(appended.fields.fractionalSecondDigits, 2);
  assert.ok(text(appended.tokens).endsWith("s.SS)"));
});
test("missing time fields use append patterns with localized labels", () => {
  assert.equal(text(resolve("en", "hs").tokens), "h\u202fa (second: s)");
  assert.equal(text(resolve("fr", "Hs").tokens), "HH (seconde: s)");
});
test("pattern combination preserves quoting, apostrophes, reversed slots and label text", () => {
  const date = parseDateTimePattern("y/M/d")!,
    time = parseDateTimePattern("H:mm")!;
  assert.equal(
    text(combineDateTimePatterns("{1} 'at' {0}", [time, date], undefined)!),
    "y/M/d at H:mm",
  );
  assert.equal(
    text(combineDateTimePatterns("{0} ({2}: {1})", [date, time], "o'clock")!),
    "y/M/d (o'clock: H:mm)",
  );
  assert.equal(
    combineDateTimePatterns("{3}", [date, time], undefined),
    undefined,
  );
  assert.equal(
    combineDateTimePatterns("'unfinished", [date, time], undefined),
    undefined,
  );
});
test("style patterns apply explicit clock cycles and preserve locale connectors", () => {
  const profile = createDateTimeCalendarProfile("en", "gregory")!;
  const result = resolveDateTimeStylePattern(profile, "long", "short", "h23");
  assert.ok(result);
  assert.equal(result.fields.hour, "2-digit");
  assert.equal(result.fields.dayPeriod, undefined);
  assert.ok(text(result.tokens).includes(" at "));
  assert.ok(!result.tokens.some((token) => token.symbol === "a"));
  const japanese = createDateTimeCalendarProfile("ja", "gregory")!;
  const twelve = resolveDateTimeStylePattern(
    japanese,
    undefined,
    "short",
    "h11",
  );
  assert.ok(twelve);
  assert.ok(twelve.tokens.some((token) => token.symbol === "K"));
  assert.equal(
    resolveDateTimeStylePattern(profile, undefined, undefined, "h23"),
    undefined,
  );
  assert.equal(
    resolveDateTimeStylePattern(profile, "invalid", undefined, "h23"),
    undefined,
  );
  assert.equal(resolveDateTimeSkeleton(profile, "QQQ", "."), undefined);
  assert.equal(resolveDateTimeSkeleton(profile, "yMy", "."), undefined);
  assert.equal(resolveDateTimeSkeleton(profile, "hH", "."), undefined);
});
