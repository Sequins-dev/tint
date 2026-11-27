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
    (get(prototype, name) as Obj).internalRareSlots!.internalCall!(
      receiver,
      args,
    );
  const options = (fields: Record<string, unknown>) => {
    const result = o.createObject<ScriptPropertyKey, unknown>(undefined);
    for (const [k, v] of Object.entries(fields))
      o.createDataProperty(result, k, v, hooks);
    return result;
  };
  const make = (locale: unknown = "en", input: unknown = undefined) => {
    return constructor.internalRareSlots!.internalConstruct!(
      [locale, input],
      constructor,
    ) as Obj;
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
  return bound.internalRareSlots!.internalCall!(undefined, [value]) as string;
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
  return ctor.internalRareSlots!.internalConstruct!(args, ctor) as Obj;
}
function types(r: ReturnType<typeof setup>, formatter: Obj, value: unknown) {
  return records(r, r.call("formatToParts", formatter, [value]) as Obj)
    .map((x) => x.type)
    .filter((x) => x !== "literal");
}
function nanos(text: string) {
  return o.createBigIntLiteral(text);
}

function localeString(
  r: ReturnType<typeof setup>,
  value: Obj,
  args: unknown[] = [],
): unknown {
  const method = r.get(value, "toLocaleString") as Obj;
  assert.ok(method, "locale method exists");
  return method.internalRareSlots!.internalCall!(value, args);
}
test("Temporal locale methods use private DateTimeFormat services with per-type defaults", () => {
  const r = setup();
  for (const [name, args] of [
    ["PlainDate", [2024, 9, 19]],
    ["PlainTime", [12, 23, 37]],
    ["PlainDateTime", [2024, 9, 19, 12, 23, 37]],
    ["PlainYearMonth", [2024, 9, "gregory"]],
    ["PlainMonthDay", [9, 19, "gregory"]],
    ["Instant", [nanos("0")]],
  ] as const) {
    const value = temporal(r, name, [...args]),
      f = r.make("en");
    assert.equal(localeString(r, value, ["en"]), formatted(r, f, value), name);
  }
});
test("locale methods validate brands before observing locales or options", () => {
  const r = setup(),
    time = temporal(r, "PlainTime", [12]),
    method = r.get(time, "toLocaleString") as Obj;
  const poison = r.options({});
  o.defineOwnProperty(
    poison,
    "length",
    {
      fields: 60,
      value: undefined,
      writable: false,
      get: o.createCallableObject<ScriptPropertyKey, unknown>(
        r.realm.functionPrototype,
        () => {
          throw "locales";
        },
      ),
      set: undefined,
      enumerable: true,
      configurable: true,
    },
    r.hooks,
  );
  r.type(
    () => method.internalRareSlots!.internalCall!(r.options({}), [poison]),
    "type",
  );
  assert.throws(
    () => method.internalRareSlots!.internalCall!(time, [poison]),
    (e) => e === "locales",
  );
  assert.equal(r.get(method, "length"), 0);
});
test("plain locale methods honor clock options while ignoring time-zone shifts and names", () => {
  const r = setup(),
    time = temporal(r, "PlainTime", [0, 30, 45, 123, 456, 789]);
  assert.equal(
    localeString(r, time, [
      "en",
      r.options({
        timeZone: "+14:00",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hourCycle: "h23",
        timeZoneName: "longOffset",
      }),
    ]),
    "00:30:45",
  );
  r.type(
    () => localeString(r, time, ["en", r.options({ dateStyle: "short" })]),
    "type",
  );
  const date = temporal(r, "PlainDate", [2024, 9, 19]);
  r.type(
    () =>
      localeString(r, date, [
        "en",
        r.options({ dateStyle: "full", timeStyle: "short" }),
      ]),
    "type",
  );
  r.type(
    () =>
      localeString(r, time, [
        "en",
        r.options({ timeStyle: "short", minute: "numeric" }),
      ]),
    "type",
  );
});
test("locale forwarding ignores mutable public Intl constructors and Temporal fields", () => {
  const r = setup(),
    date = temporal(r, "PlainDate", [2024, 9, 19]);
  o.createDataProperty(r.intl, "DateTimeFormat", 0, r.hooks);
  o.createDataProperty(date, "year", 0, r.hooks);
  o.createDataProperty(date, "toString", 0, r.hooks);
  assert.equal(localeString(r, date, ["en"]), "9/19/2024");
});
test("ZonedDateTime locale formatting uses its own zone and adds the default zone label", () => {
  const r = setup(),
    zoned = temporal(r, "ZonedDateTime", [nanos("0"), "+01:00"]);
  const result = localeString(r, zoned, ["en"]);
  assert.equal(typeof result, "string");
  assert.ok(String(result).includes("1:00:00"));
  assert.ok(String(result).includes("GMT+1"));
  r.realm.systemTimeZoneIdentifier = undefined;
  assert.equal(localeString(r, zoned, ["en"]), result);
  const zero = temporal(r, "ZonedDateTime", [nanos("0"), "+00:00"]),
    zeroText = String(localeString(r, zero, ["en"]));
  assert.ok(zeroText.includes("GMT"));
  assert.ok(!zeroText.includes("+") && !zeroText.includes("-"));
});
test("ZonedDateTime rejects any defined timeZone option before coercing it", () => {
  const r = setup(),
    zoned = temporal(r, "ZonedDateTime", [nanos("0"), "UTC"]),
    options = r.options({
      timeZone: r.options({
        toString: o.createCallableObject<ScriptPropertyKey, unknown>(
          r.realm.functionPrototype,
          () => {
            throw "zone coercion";
          },
        ),
      }),
    });
  r.type(() => localeString(r, zoned, ["en", options]), "type");
  r.type(
    () => localeString(r, zoned, ["en", r.options({ timeZone: "UTC" })]),
    "type",
  );
  assert.equal(
    typeof localeString(r, zoned, [
      "en",
      r.options({ dateStyle: "full", timeStyle: "full" }),
    ]),
    "string",
  );
});
test("locale calendar compatibility matches DateTimeFormat and accepts ISO ZonedDateTime", () => {
  const r = setup(),
    iso = temporal(r, "ZonedDateTime", [nanos("0"), "UTC"]),
    gregory = temporal(r, "ZonedDateTime", [nanos("0"), "UTC", "gregory"]),
    hebrew = temporal(r, "ZonedDateTime", [nanos("0"), "UTC", "hebrew"]);
  assert.equal(localeString(r, iso, ["en"]), localeString(r, gregory, ["en"]));
  r.type(() => localeString(r, hebrew, ["en"]), "range");
  const parts = temporal(r, "PlainYearMonth", [2024, 9, "iso8601"]);
  r.type(() => localeString(r, parts, ["en"]), "range");
  assert.equal(
    typeof localeString(r, parts, ["en", r.options({ calendar: "iso8601" })]),
    "string",
  );
});
