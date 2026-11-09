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
  o.installIntlIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "NumberFormat")!.value as Obj;
  const prototype = o.getOwnProperty(constructor, "prototype")!.value as Obj;
  const get = (object: Obj, key: ScriptPropertyKey) =>
    o.getProperty(object, key, object, hooks);
  const options = (fields: Record<string, unknown>) => {
    const result = o.createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    for (const [k, v] of Object.entries(fields))
      o.createDataProperty(result, k, v, hooks);
    return result;
  };
  const make = (locale: string, fields: Record<string, unknown>) =>
    constructor.internalConstruct!(
      [locale, options(fields)],
      constructor,
    ) as Obj;
  const format = (
    locale: string,
    fields: Record<string, unknown>,
    value: unknown,
  ) => {
    const nf = make(locale, fields);
    const fn = get(nf, "format") as Obj;
    return fn.internalCall!(undefined, [value]);
  };
  const resolved = (locale: string, fields: Record<string, unknown>) =>
    (get(prototype, "resolvedOptions") as Obj).internalCall!(
      make(locale, fields),
      [],
    ) as Obj;
  return { get, format, resolved };
}

test("compact notation covers missing-number plural forms, currency, percent, units and signs", () => {
  const f = setup();
  const compactLong = { notation: "compact", compactDisplay: "long" };
  assert.equal(f.format("it", compactLong, 1000), "mille");
  assert.equal(f.format("it", compactLong, 2000), "2 mila");
  assert.equal(
    f.format(
      "en",
      { notation: "compact", style: "currency", currency: "USD" },
      1234,
    ),
    "$1.2K",
  );
  assert.equal(
    f.format(
      "de",
      { notation: "compact", style: "currency", currency: "EUR" },
      1234567,
    ),
    "1,2 Mio. €",
  );
  assert.equal(
    f.format(
      "ja",
      { notation: "compact", style: "currency", currency: "JPY" },
      123456,
    ),
    "￥12万",
  );
  assert.equal(
    f.format("en", { notation: "compact", signDisplay: "always" }, 98765),
    "+99K",
  );
  assert.equal(
    f.format("en", { notation: "compact", style: "percent" }, 12.34),
    "1.2K%",
  );
  assert.equal(
    f.format(
      "en",
      { notation: "compact", style: "unit", unit: "second" },
      12345,
    ),
    "12K sec",
  );
});

test("resolvedOptions reports notation, compactDisplay only for compact, and compact grouping", () => {
  const f = setup();
  const compact = f.resolved("en", {
    notation: "compact",
    compactDisplay: "long",
  });
  assert.equal(f.get(compact, "notation"), "compact");
  assert.equal(f.get(compact, "compactDisplay"), "long");
  assert.equal(f.get(compact, "useGrouping"), "min2");
  assert.equal(f.get(compact, "maximumFractionDigits"), 0);
  const scientific = f.resolved("en", { notation: "scientific" });
  assert.equal(f.get(scientific, "notation"), "scientific");
  assert.equal(f.get(scientific, "compactDisplay"), undefined);
  assert.equal(f.get(scientific, "maximumFractionDigits"), 3);
});

test("unit style formats every sanctioned unit and per compounds from CLDR", () => {
  const f = setup();
  const unit = (
    locale: string,
    name: string,
    display: string,
    value: unknown = 123,
  ) =>
    f.format(
      locale,
      { style: "unit", unit: name, unitDisplay: display },
      value,
    );
  const cases: [string, string, string, string][] = [
    ["en", "kilometer-per-hour", "short", "123 km/h"],
    ["en", "kilometer-per-hour", "narrow", "123km/h"],
    ["en", "kilometer-per-hour", "long", "123 kilometers per hour"],
    ["de", "kilometer-per-hour", "long", "123 Kilometer pro Stunde"],
    ["ko", "kilometer-per-hour", "long", "시속 123킬로미터"],
    ["en", "liter-per-second", "short", "123 L/s"],
    ["en", "liter-per-second", "long", "123 liters per second"],
    ["en", "gram-per-liter", "long", "123 grams per liter"],
    ["en", "kilobyte-per-week", "short", "123 kB/w"],
    ["en", "mile-per-gallon", "short", "123 mpg"],
    ["en", "acre", "long", "123 acres"],
    ["en", "fluid-ounce", "narrow", "123fl oz"],
    ["de", "meter-per-second", "long", "123 Meter pro Sekunde"],
    ["ja", "liter-per-second", "short", "123 L/秒"],
  ];
  for (const [locale, name, display, expected] of cases)
    assert.equal(
      unit(locale, name, display),
      expected,
      `${locale} ${name} ${display}`,
    );
  assert.equal(unit("en", "acre", "long", 1), "1 acre");
  assert.equal(unit("en", "gram-per-liter", "long", 1), "1 gram per liter");
  assert.equal(unit("en", "kilometer-per-hour", "short", -987), "-987 km/h");
});
