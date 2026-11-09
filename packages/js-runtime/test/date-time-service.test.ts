import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDateTimeFormatter,
  dateTimeFormatParts,
} from "../src/objects/date-time-format.ts";
import { resolveDateTimeLocale } from "../src/objects/date-time-locale.ts";
import * as factory from "../src/objects/date-time-service-factory.ts";
import type { DateTimeFormatConfiguration } from "../src/objects/date-time-service-contracts.ts";
import {
  dateTimePatternFields,
  parseDateTimePattern,
} from "../src/objects/date-time-pattern.ts";
test("formatter service preserves exact locale, parts and independent formatter state", () => {
  assert.equal(typeof factory.createDateTimeService, "function");
  const a = factory.createDateTimeService(),
    b = factory.createDateTimeService();
  assert.notEqual(a, b);
  const configuration: DateTimeFormatConfiguration = {
    locale: resolveDateTimeLocale(
      ["en"],
      "hebrew",
      undefined,
      "h23",
      undefined,
    ),
    timeZone: { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 },
    fields: dateTimePatternFields(parseDateTimePattern("yMMMMd")!)!,
    dateStyle: undefined,
    timeStyle: undefined,
    formatMatcher: "best fit",
  };
  assert.deepEqual(
    a.resolveDateTimeLocale(["en"], "hebrew", undefined, "h23", undefined),
    configuration.locale,
  );
  const reference = createDateTimeFormatter(configuration),
    one = a.createDateTimeFormatter(configuration, "any", "date"),
    two = b.createDateTimeFormatter(configuration, "any", "date");
  assert.ok(reference && one && two);
  assert.notEqual(one.temporalPatterns, two.temporalPatterns);
  assert.deepEqual(
    a.dateTimeFormatParts(one, 0),
    dateTimeFormatParts(reference, 0),
  );
  assert.deepEqual(
    b.dateTimeFormatParts(two, 0),
    dateTimeFormatParts(reference, 0),
  );
  assert.equal(a.dateTimeFormatParts(one, NaN), undefined);
});
