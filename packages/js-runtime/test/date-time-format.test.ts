import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimeFormatter,
  dateTimeFormatParts,
  dateTimeFormatRangeParts,
} from "../src/objects/date-time-format.ts";
import { resolveDateTimeLocale } from "../src/objects/date-time-locale.ts";
import {
  parseDateTimePattern,
  dateTimePatternFields,
} from "../src/objects/date-time-pattern.ts";
function make(
  skeleton: string,
  locale = "en",
  calendar?: string,
  timeZone = "UTC",
  offsetSeconds = 0,
  matcher = "best fit",
) {
  const fields = dateTimePatternFields(parseDateTimePattern(skeleton)!);
  assert.ok(fields);
  const result = createDateTimeFormatter({
    locale: resolveDateTimeLocale(
      [locale],
      calendar,
      undefined,
      "h23",
      undefined,
    ),
    timeZone: {
      kind: "fixed",
      identifier: timeZone,
      offsetNanoseconds: offsetSeconds * 1e9,
    },
    fields,
    dateStyle: undefined,
    timeStyle: undefined,
    formatMatcher: matcher,
  });
  assert.ok(result);
  return result;
}
const text = (parts: readonly { value: string }[] | undefined) => {
  assert.ok(parts);
  return parts.map((x) => x.value).join("");
};
test("assembled formatter applies clipping before exact local offset conversion", () => {
  const f = make("yMMddHHmmssSSS", "en", "gregory", "+01:00", 3600);
  assert.equal(text(dateTimeFormatParts(f, -1.9)), "01/01/1970, 00:59:59.999");
  assert.equal(dateTimeFormatParts(f, NaN), undefined);
  assert.equal(dateTimeFormatParts(f, 8640000000000001), undefined);
  const boundary = dateTimeFormatParts(f, 8640000000000000);
  assert.ok(boundary);
  assert.equal(boundary.find((x) => x.type === "year")?.value, "275760");
});
test("assembled formatter resolves parts, calendar arithmetic and localized zone labels together", () => {
  const f = make("yMMMdHHmmOOOO", "en", "hebrew", "+05:30", 19800);
  const parts = dateTimeFormatParts(f, Date.UTC(2024, 3, 23));
  assert.equal(text(parts), "15 Nisan 5784, 05:30 GMT+05:30");
  const arabic = make("yMd", "en-u-nu-arab");
  assert.equal(text(dateTimeFormatParts(arabic, 0)), "١/١/١٩٧٠");
});
test("assembled ranges share calendar precision and preserve reversed inputs", () => {
  const f = make("yMMMd");
  const a = Date.UTC(2019, 0, 3),
    b = Date.UTC(2019, 0, 5);
  assert.equal(
    text(dateTimeFormatRangeParts(f, a, b)),
    "Jan 3\u2009–\u20095, 2019",
  );
  assert.equal(
    text(dateTimeFormatRangeParts(f, b, a)),
    "Jan 5\u2009–\u20093, 2019",
  );
  assert.equal(dateTimeFormatRangeParts(f, NaN, b), undefined);
});
test("basic matching supplies all required date and time subsets and chooses component scores", () => {
  for (const skeleton of [
    "yMd",
    "yM",
    "Md",
    "y",
    "M",
    "d",
    "HHmmss",
    "HHmm",
    "HH",
    "yMdHHmmss",
  ]) {
    const f = make(skeleton, "en", undefined, "UTC", 0, "basic");
    assert.equal(
      f.pattern.fields.year,
      skeleton.includes("y") ? "numeric" : undefined,
    );
    assert.equal(
      f.pattern.fields.second,
      skeleton.includes("s") ? "2-digit" : undefined,
    );
    assert.ok(dateTimeFormatParts(f, 0));
  }
});
test("style assembly uses the requested clock family and preserves actual field metadata", () => {
  const f = createDateTimeFormatter({
    locale: resolveDateTimeLocale(
      ["en"],
      undefined,
      undefined,
      "h24",
      undefined,
    ),
    timeZone: { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
    fields: dateTimePatternFields([])!,
    dateStyle: "long",
    timeStyle: "short",
    formatMatcher: "best fit",
  });
  assert.ok(f);
  assert.equal(text(dateTimeFormatParts(f, 0)), "January 1, 1970 at 24:00");
});
test("lunisolar range years retain relatedYear identities when CLDR intervals use ordinary year symbols", () => {
  for (const calendar of ["chinese", "dangi"]) {
    const f = make("yMd", "en-US", calendar);
    const parts = dateTimeFormatRangeParts(
      f,
      Date.parse("2000-01-01T00:00Z"),
      Date.parse("1900-01-01T00:00Z"),
    );
    assert.ok(parts);
    assert.equal(
      parts.find((x) => x.type === "relatedYear" && x.source === "startRange")
        ?.value,
      "1999",
    );
    assert.equal(
      parts.find((x) => x.type === "relatedYear" && x.source === "endRange")
        ?.value,
      "1899",
    );
  }
});
