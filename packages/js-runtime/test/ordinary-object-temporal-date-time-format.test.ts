import { after, test } from "node:test";
import assert from "node:assert/strict";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
function setup() {
  const root = o.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const r = o.callObjectValue(fn, receiver, args, root);
      assert.equal(r.error, "none");
      return r.value;
    },
  };
  const realm = o.createErrorRealm(root, hooks);
  realm.systemTimeZoneIdentifier = () => "UTC";
  realm.wallClockMilliseconds = () => 0;
  o.installTemporalIntrinsics(root, realm, hooks);
  o.installIntlIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "DateTimeFormat")?.value as Obj;
  assert.ok(constructor, "DateTimeFormat is installed");
  const prototype = o.getOwnProperty(constructor, "prototype")!.value as Obj;
  const get = (object: Obj, key: string) =>
    o.getProperty(object, key, object, hooks);
  const call = (name: string, receiver: unknown, args: unknown[] = []) =>
    (get(prototype, name) as Obj).internalCall!(receiver, args);
  const options = (fields: Record<string, unknown>) => {
    const result = o.createObject<ScriptPropertyKey, unknown>(undefined);
    for (const [k, v] of Object.entries(fields))
      o.createDataProperty(result, k, v, hooks);
    return result;
  };
  const make = (locale: unknown = "en", input: unknown = undefined) => {
    return constructor.internalConstruct!([locale, input], constructor) as Obj;
  };
  const type = (run: () => unknown, kind: string) =>
    assert.throws(
      run,
      (e) => (e as Obj).prototype === realm.prototypes.get(kind),
    );
  return {
    root,
    realm,
    hooks,
    intl,
    constructor,
    prototype,
    get,
    call,
    options,
    make,
    type,
  };
}

function formatted(
  r: ReturnType<typeof setup>,
  formatter: Obj,
  value: unknown = 0,
): string {
  const bound = r.get(formatter, "format") as Obj;
  return bound.internalCall!(undefined, [value]) as string;
}
function records(
  r: ReturnType<typeof setup>,
  array: Obj,
): Record<string, unknown>[] {
  return Array.from({ length: Number(r.get(array, "length")) }, (_, index) => {
    const item = r.get(array, String(index)) as Obj;
    const result: Record<string, unknown> = {
      type: r.get(item, "type"),
      value: r.get(item, "value"),
    };
    if (o.getOwnProperty(item, "source")) result.source = r.get(item, "source");
    return result;
  });
}

function temporal(
  r: ReturnType<typeof setup>,
  name: string,
  args: unknown[],
): Obj {
  const group = r.get(r.root, "Temporal") as Obj,
    ctor = r.get(group, name) as Obj;
  return ctor.internalConstruct!(args, ctor) as Obj;
}
function types(r: ReturnType<typeof setup>, formatter: Obj, value: unknown) {
  return records(r, r.call("formatToParts", formatter, [value]) as Obj)
    .map((x) => x.type)
    .filter((x) => x !== "literal");
}
function nanos(text: string) {
  return o.createBigIntLiteral(text);
}
test("public DateTimeFormat selects defaults per Temporal type without inheriting legacy Date defaults", () => {
  const r = setup(),
    f = r.make("en", r.options({ calendar: "iso8601" }));
  for (const [name, args, expected] of [
    ["PlainDate", [2024, 9, 19], ["month", "day", "year"]],
    ["PlainYearMonth", [2024, 9, "iso8601"], ["month", "year"]],
    ["PlainMonthDay", [9, 19, "iso8601", 1972], ["month", "day"]],
    ["PlainTime", [12, 23, 37, 847], ["hour", "minute", "second", "dayPeriod"]],
    [
      "PlainDateTime",
      [2024, 9, 19, 12, 23, 37, 847],
      ["month", "day", "year", "hour", "minute", "second", "dayPeriod"],
    ],
    [
      "Instant",
      [nanos("1726773817847000000")],
      ["month", "day", "year", "hour", "minute", "second", "dayPeriod"],
    ],
  ] as const) {
    assert.deepEqual(types(r, f, temporal(r, name, [...args])), expected, name);
  }
  assert.deepEqual(types(r, f, 0), ["month", "day", "year"]);
});
test("plain values filter unsupported fields and reject requests with no component overlap", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({ month: "2-digit", hour: "2-digit", calendar: "iso8601" }),
    );
  const date = temporal(r, "PlainDate", [2024, 9, 19]),
    time = temporal(r, "PlainTime", [12, 23]);
  assert.deepEqual(types(r, f, date), ["month"]);
  assert.deepEqual(types(r, f, time), ["hour", "dayPeriod"]);
  const year = r.make(
    "en",
    r.options({ year: "numeric", calendar: "iso8601" }),
  );
  r.type(() => formatted(r, year, time), "type");
  r.type(
    () => formatted(r, year, temporal(r, "PlainMonthDay", [9, 19, "iso8601"])),
    "type",
  );
});
test("plain formats ignore offsets and remove time-zone names while instant formats retain them", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({
        hour: "numeric",
        minute: "numeric",
        timeZone: "+14:00",
        timeZoneName: "longOffset",
        hourCycle: "h23",
      }),
    );
  assert.equal(formatted(r, f, temporal(r, "PlainTime", [2, 15])), "02:15");
  assert.equal(
    formatted(r, f, temporal(r, "PlainDateTime", [2024, 9, 19, 2, 15])),
    "02:15",
  );
  assert.ok(
    formatted(r, f, temporal(r, "Instant", [nanos("0")])).includes(
      "14:00 GMT+14:00",
    ),
  );
});
test("style adaptation preserves sufficient base patterns and rejects incompatible styles", () => {
  const r = setup(),
    date = temporal(r, "PlainDate", [2024, 9, 19]),
    time = temporal(r, "PlainTime", [12, 23]),
    ym = temporal(r, "PlainYearMonth", [2024, 9, "gregory"]);
  const dates = r.make("en", r.options({ dateStyle: "full" }));
  assert.ok(formatted(r, dates, date).includes("September 19, 2024"));
  assert.equal(formatted(r, dates, ym), "September 2024");
  r.type(() => formatted(r, dates, time), "type");
  const clocks = r.make("en", r.options({ timeStyle: "long" }));
  r.type(() => formatted(r, clocks, date), "type");
  assert.ok(!types(r, clocks, time).includes("timeZoneName"));
});
test("calendar compatibility allows ISO dates but requires identical partial-date calendars", () => {
  const r = setup(),
    gregory = r.make("en"),
    hebrew = r.make(
      "en",
      r.options({
        calendar: "hebrew",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
  const iso = temporal(r, "PlainDate", [2024, 4, 23]);
  assert.equal(formatted(r, hebrew, iso), "15 Nisan 5784");
  r.type(
    () =>
      formatted(r, gregory, temporal(r, "PlainDate", [2024, 4, 23, "hebrew"])),
    "range",
  );
  r.type(
    () =>
      formatted(
        r,
        gregory,
        temporal(r, "PlainYearMonth", [2024, 4, "iso8601"]),
      ),
    "range",
  );
  r.type(
    () =>
      formatted(r, gregory, temporal(r, "PlainMonthDay", [4, 23, "iso8601"])),
    "range",
  );
});
test("plain boundary coordinates bypass TimeClip and preserve weekday computation", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({
        weekday: "long",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        calendar: "iso8601",
      }),
    );
  const min = temporal(r, "PlainDate", [-271821, 4, 19]),
    max = temporal(
      r,
      "PlainDateTime",
      [275760, 9, 13, 23, 59, 59, 999, 999, 999],
    );
  assert.ok(formatted(r, f, min).includes("271822"));
  assert.ok(formatted(r, f, max).includes("275760"));
  const actual = records(r, r.call("formatToParts", f, [min]) as Obj);
  assert.equal(actual.find((x) => x.type === "weekday")?.value, "Monday");
});
test("instant formatting floors negative nanoseconds without a floating point millisecond round trip", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hourCycle: "h23",
      }),
    );
  assert.equal(
    formatted(r, f, temporal(r, "Instant", [nanos("-1")])),
    "23:59:59.999",
  );
});
test("ranges require one Temporal type after both argument conversions and reject ZonedDateTime", () => {
  const r = setup(),
    f = r.make("en"),
    date = temporal(r, "PlainDate", [2024, 9, 19]),
    time = temporal(r, "PlainTime", [12, 23]),
    zoned = temporal(r, "ZonedDateTime", [nanos("0"), "UTC"]);
  r.type(() => r.call("formatRange", f, [date, time]), "type");
  r.type(() => r.call("formatRange", f, [date, 0]), "type");
  const poison = r.options({
    valueOf: o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        throw "conversion";
      },
    ),
  });
  assert.throws(
    () => r.call("formatRange", f, [date, poison]),
    (x) => x === "conversion",
  );
  r.type(() => formatted(r, f, zoned), "type");
  r.type(() => r.call("formatRange", f, [zoned, zoned]), "type");
  const parts = records(
    r,
    r.call("formatRangeToParts", f, [
      date,
      temporal(r, "PlainDate", [2024, 9, 21]),
    ]) as Obj,
  );
  assert.ok(parts.some((x) => x.source === "endRange"));
});
