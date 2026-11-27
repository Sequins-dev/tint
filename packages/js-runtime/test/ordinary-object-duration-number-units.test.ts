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
  o.installIntlIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "NumberFormat")?.value as Obj;
  assert.ok(constructor, "NumberFormat is installed");
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

test("NumberFormat formats all DurationFormat time units using plural-aware CLDR patterns", () => {
  const r = setup();
  for (const [unit, one, many] of [
    ["year", "1 year", "2 years"],
    ["month", "1 month", "2 months"],
    ["week", "1 week", "2 weeks"],
    ["day", "1 day", "2 days"],
    ["hour", "1 hour", "2 hours"],
    ["minute", "1 minute", "2 minutes"],
    ["second", "1 second", "2 seconds"],
    ["millisecond", "1 millisecond", "2 milliseconds"],
    ["microsecond", "1 microsecond", "2 microseconds"],
    ["nanosecond", "1 nanosecond", "2 nanoseconds"],
  ]) {
    const f = r.make(
      "en",
      r.options({ style: "unit", unit, unitDisplay: "long" }),
    );
    assert.equal(formatted(r, f, 1), one);
    assert.equal(formatted(r, f, 2), many);
    assert.equal(r.get(r.call("resolvedOptions", f) as Obj, "unit"), unit);
  }
});
test("time-unit numeric parts retain exact fractions, digit systems and a single unit label", () => {
  const r = setup(),
    f = r.make(
      "en-u-nu-arab",
      r.options({
        style: "unit",
        unit: "second",
        unitDisplay: "long",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    );
  const parts = records(r, r.call("formatToParts", f, [1.25]) as Obj);
  assert.equal(parts.map((x) => x.value).join(""), "١٫٢٥٠ seconds");
  assert.equal(parts.filter((x) => x.type === "unit").length, 1);
});
test("Arabic singular and dual unit templates omit numeric fields but keep negative signs", () => {
  const r = setup(),
    f = r.make(
      "ar",
      r.options({ style: "unit", unit: "year", unitDisplay: "long" }),
    );
  assert.equal(formatted(r, f, 1), "سنة");
  assert.equal(formatted(r, f, 2), "سنتان");
  assert.equal(formatted(r, f, -2), "\u200e-سنتان");
  const parts = records(r, r.call("formatToParts", f, [2]) as Obj);
  assert.deepEqual(parts, [{ type: "unit", value: "سنتان" }]);
});
