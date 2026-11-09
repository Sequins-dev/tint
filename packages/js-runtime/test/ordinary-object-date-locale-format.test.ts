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
  realm.localTimeOffsetSeconds = () => 0;
  realm.localTimeToUTC = (value) => value;
  o.installTemporalIntrinsics(root, realm, hooks);
  o.installPrimitiveIntrinsics(root, realm, hooks);
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

function date(r: ReturnType<typeof setup>, value: number): Obj {
  const ctor = r.get(r.root, "Date") as Obj;
  return ctor.internalConstruct!([value], ctor) as Obj;
}
function callDate(
  r: ReturnType<typeof setup>,
  name: string,
  value: unknown,
  args: unknown[] = [],
): unknown {
  const method = r.get(r.realm.datePrototype, name) as Obj;
  return method.internalCall!(value, args);
}
test("Date locale methods forward to the same private formatter used for Temporal", () => {
  const r = setup(),
    value = date(r, 0),
    options = r.options({ timeZone: "UTC", hourCycle: "h23" });
  assert.equal(
    callDate(r, "toLocaleString", value, ["en", options]),
    "1/1/1970, 00:00:00",
  );
  assert.equal(
    callDate(r, "toLocaleDateString", value, ["en", options]),
    "1/1/1970",
  );
  assert.equal(
    callDate(r, "toLocaleTimeString", value, ["en", options]),
    "00:00:00",
  );
  const instant = temporal(r, "Instant", [nanos("0")]),
    method = r.get(instant, "toLocaleString") as Obj;
  assert.equal(
    method.internalCall!(instant, ["en", options]),
    callDate(r, "toLocaleString", value, ["en", options]),
  );
});
test("Date defaults preserve unrelated explicit components while Temporal filters them", () => {
  const r = setup(),
    value = date(r, 0);
  assert.ok(
    String(
      callDate(r, "toLocaleDateString", value, [
        "en",
        r.options({ hour: "numeric", hourCycle: "h23" }),
      ]),
    ).includes("1/1/1970"),
  );
  const clock = String(
    callDate(r, "toLocaleTimeString", value, [
      "en",
      r.options({ year: "numeric", hourCycle: "h23" }),
    ]),
  );
  assert.ok(clock.includes("1970") && clock.includes("00:00:00"));
});
test("Date locale brand and invalid-value checks precede option access", () => {
  const r = setup();
  r.type(
    () => callDate(r, "toLocaleString", r.options({}), ["en", null]),
    "type",
  );
  assert.equal(
    callDate(r, "toLocaleString", date(r, NaN), ["bad_tag", null]),
    "Invalid Date",
  );
  r.type(() => callDate(r, "toLocaleString", date(r, 0), ["en", null]), "type");
});
test("date-only and time-only locale methods reject incompatible styles", () => {
  const r = setup(),
    value = date(r, 0);
  r.type(
    () =>
      callDate(r, "toLocaleDateString", value, [
        "en",
        r.options({ timeStyle: "short" }),
      ]),
    "type",
  );
  r.type(
    () =>
      callDate(r, "toLocaleTimeString", value, [
        "en",
        r.options({ dateStyle: "short" }),
      ]),
    "type",
  );
});
test("Date locale methods do not consult mutable public Intl formatters", () => {
  const r = setup(),
    value = date(r, 0);
  o.createDataProperty(r.intl, "DateTimeFormat", undefined, r.hooks);
  assert.equal(
    callDate(r, "toLocaleDateString", value, [
      "en",
      r.options({ calendar: "hebrew" }),
    ]),
    "23 Tevet 5730",
  );
});
