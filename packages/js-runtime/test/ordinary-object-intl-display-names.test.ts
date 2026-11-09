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
const keyOrder = (key: ScriptPropertyKey) =>
  typeof key === "string" ? o.stringPropertyKeyOrder(key) : -1;

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
  const constructor = o.getOwnProperty(intl, "DisplayNames")?.value as Obj;
  assert.ok(constructor, "Intl.DisplayNames is installed");
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
  const make = (locale: unknown, fields: Record<string, unknown> | undefined) =>
    constructor.internalConstruct!(
      [locale, fields === undefined ? undefined : options(fields)],
      constructor,
    ) as Obj;
  const of = (names: Obj, code: unknown) =>
    (get(prototype, "of") as Obj).internalCall!(names, [code]);
  const resolved = (names: Obj) =>
    (get(prototype, "resolvedOptions") as Obj).internalCall!(names, []) as Obj;
  const isError = (kind: string) => (e: unknown) =>
    (e as Obj).prototype === realm.prototypes.get(kind);
  return {
    realm,
    hooks,
    constructor,
    prototype,
    get,
    options,
    make,
    of,
    resolved,
    isError,
  };
}

test("DisplayNames requires new, an options object and a type", () => {
  const r = setup();
  assert.equal(r.get(r.constructor, "length"), 2);
  assert.throws(
    () =>
      r.constructor.internalCall!(undefined, [
        "en",
        r.options({ type: "region" }),
      ]),
    r.isError("type"),
  );
  assert.throws(() => r.make("en", undefined), r.isError("type"));
  assert.throws(() => r.make("en", {}), r.isError("type"));
  assert.throws(
    () => r.constructor.internalConstruct!(["en", "region"], r.constructor),
    r.isError("type"),
  );
  assert.throws(
    () => r.make("en", { type: "region", style: "tiny" }),
    r.isError("range"),
  );
  assert.throws(
    () => r.make("en", { type: "region", fallback: "nothing" }),
    r.isError("range"),
  );
  assert.throws(
    () => r.make("en", { type: "language", languageDisplay: "plain" }),
    r.isError("range"),
  );
  assert.throws(
    () => r.make("en", { type: "region", localeMatcher: "exact" }),
    r.isError("range"),
  );
});

test("DisplayNames reads options in specification order", () => {
  const r = setup();
  const seen: string[] = [];
  const opts = r.options({});
  for (const name of [
    "localeMatcher",
    "style",
    "type",
    "fallback",
    "languageDisplay",
  ])
    o.defineOwnProperty(
      opts,
      name,
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: o.createCallableObject<ScriptPropertyKey, unknown>(
          r.realm.functionPrototype,
          () => {
            seen.push(name);
            return name === "type" ? "region" : undefined;
          },
        ),
        set: undefined,
        enumerable: true,
        configurable: true,
      },
      r.hooks,
    );
  r.constructor.internalConstruct!(["en", opts], r.constructor);
  assert.deepEqual(seen, [
    "localeMatcher",
    "style",
    "type",
    "fallback",
    "languageDisplay",
  ]);
});

test("canonical codes and RangeErrors follow CanonicalCodeForDisplayNames", () => {
  const r = setup();
  const region = r.make("en", { type: "region" }),
    script = r.make("en", { type: "script" }),
    currency = r.make("en", { type: "currency" }),
    calendar = r.make("en", { type: "calendar" }),
    field = r.make("en", { type: "dateTimeField" }),
    language = r.make("en", { type: "language" });
  assert.equal(r.of(region, "gb"), "United Kingdom");
  assert.equal(r.of(region, "419"), "Latin America");
  assert.equal(r.of(script, "latn"), "Latin");
  assert.equal(r.of(currency, "usd"), "US Dollar");
  assert.equal(r.of(calendar, "GREGORY"), "Gregorian Calendar");
  assert.equal(r.of(calendar, "islamicc"), r.of(calendar, "islamic-civil"));
  assert.equal(r.of(field, "weekOfYear"), "week");
  assert.equal(r.of(field, "timeZoneName"), "time zone");
  for (const [names, code] of [
    [region, "a"],
    [region, "aaa"],
    [region, "1111"],
    [script, "abc"],
    [script, "abcd1"],
    [currency, "us"],
    [currency, "us1"],
    [calendar, "ab"],
    [calendar, "123_abc"],
    [calendar, "abc def"],
    [field, "timezonename"],
    [field, "seconds"],
    [language, ""],
    [language, "en-u-hebrew"],
    [language, "aa-bb-cc"],
    [language, "root"],
  ] as const)
    assert.throws(() => r.of(names, code), r.isError("range"), String(code));
});

test("language names use dialect or standard composition", () => {
  const r = setup();
  const dialect = r.make("en", { type: "language" }),
    standard = r.make("en", { type: "language", languageDisplay: "standard" }),
    short = r.make("en", { type: "language", style: "short" });
  assert.equal(r.of(dialect, "en-GB"), "British English");
  assert.equal(r.of(standard, "en-GB"), "English (United Kingdom)");
  assert.equal(r.of(short, "en-GB"), "UK English");
  assert.equal(r.of(dialect, "zh-Hant"), "Traditional Chinese");
  assert.equal(r.of(standard, "fr-Latn-CA"), "French (Latin, Canada)");
  assert.equal(r.of(dialect, "EN-us"), "American English");
});

test("styles select short and narrow variants with long fallback", () => {
  const r = setup();
  assert.equal(
    r.of(r.make("en", { type: "region", style: "short" }), "GB"),
    "UK",
  );
  assert.equal(
    r.of(r.make("en", { type: "region", style: "narrow" }), "GB"),
    "UK",
  );
  assert.equal(
    r.of(r.make("en", { type: "region", style: "short" }), "FR"),
    "France",
  );
  assert.equal(
    r.of(r.make("en", { type: "currency", style: "short" }), "USD"),
    "$",
  );
  assert.equal(
    r.of(r.make("en", { type: "dateTimeField", style: "short" }), "year"),
    "yr.",
  );
  assert.equal(
    r.of(r.make("en", { type: "dateTimeField", style: "narrow" }), "year"),
    "yr",
  );
});

test("fallback code returns the canonical code; none returns undefined", () => {
  const r = setup();
  assert.equal(r.of(r.make("en", { type: "region" }), "aa"), "AA");
  assert.equal(
    r.of(r.make("en", { type: "region", fallback: "none" }), "aa"),
    undefined,
  );
  assert.equal(r.of(r.make("en", { type: "currency" }), "xyz"), "XYZ");
  assert.equal(
    r.of(r.make("en", { type: "language", fallback: "none" }), "xqq"),
    undefined,
  );
});

test("methods require DisplayNames receivers; resolvedOptions keeps key order", () => {
  const r = setup();
  const of = r.get(r.prototype, "of") as Obj;
  assert.throws(
    () => of.internalCall!(r.options({}), ["GB"]),
    r.isError("type"),
  );
  assert.throws(() => of.internalCall!(r.prototype, ["GB"]), r.isError("type"));
  const region = r.resolved(r.make("en-US", { type: "region" }));
  assert.deepEqual(o.ownKeys(region, keyOrder), [
    "locale",
    "style",
    "type",
    "fallback",
  ]);
  // en-US is an available locale (it shares the en table).
  assert.equal(r.get(region, "locale"), "en-US");
  assert.equal(
    r.get(r.resolved(r.make("en-GB", { type: "region" })), "locale"),
    "en",
  );
  assert.equal(r.get(region, "languageDisplay"), undefined);
  const language = r.resolved(
    r.make(undefined, { type: "language", style: "short", fallback: "none" }),
  );
  assert.deepEqual(o.ownKeys(language, keyOrder), [
    "locale",
    "style",
    "type",
    "fallback",
    "languageDisplay",
  ]);
  for (const [key, value] of [
    ["locale", "en"],
    ["style", "short"],
    ["type", "language"],
    ["fallback", "none"],
    ["languageDisplay", "dialect"],
  ] as const)
    assert.equal(r.get(language, key), value, key);
});
