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
const objects = await import("../src/objects/index.ts");
type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;
function setup(methodName = "getCalendars") {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!.value as ObjectValue,
    constructor = objects.getOwnProperty(intl, "Locale")!.value as ObjectValue,
    prototype = objects.getOwnProperty(constructor, "prototype")!
      .value as ObjectValue;
  const method = objects.getOwnProperty(prototype, methodName)!
    .value as ObjectValue;
  function locale(tag: string): ObjectValue {
    const result = objects.constructObjectValue(constructor, [tag], root);
    assert.equal(result.error, "none");
    return result.value as ObjectValue;
  }
  return { root, realm, hooks, intl, prototype, method, locale };
}
function values(array: ObjectValue): unknown[] {
  const length = objects.getOwnProperty(array, "length")!.value as number;
  return Array.from(
    { length },
    (_, i) => objects.getOwnProperty(array, String(i))!.value,
  );
}
test("Locale calendar methods have ordinary builtin metadata and preserve explicit empty/unknown slots", () => {
  const r = setup();
  assert.equal(objects.getOwnProperty(r.method, "name")!.value, "getCalendars");
  assert.equal(objects.getOwnProperty(r.method, "length")!.value, 0);
  assert.equal(r.method.internalConstruct, undefined);
  for (const [tag, expected] of [
    ["en-u-ca", [""]],
    ["en-u-ca-true", [""]],
    ["en-u-ca-islamicc", ["islamic-civil"]],
    ["en-u-ca-foobar", ["foobar"]],
  ] as const)
    assert.deepEqual(
      values(r.method.internalCall!(r.locale(tag), []) as ObjectValue),
      expected,
      tag,
    );
});
test("calendar results use the method realm, are fresh and do not consult a receiver toString", () => {
  const own = setup(),
    foreign = setup(),
    locale = foreign.locale("th-TH");
  objects.createDataProperty(
    locale,
    "toString",
    () => {
      throw new Error("observable coercion");
    },
    own.hooks,
  );
  const first = own.method.internalCall!(locale, []) as ObjectValue,
    second = own.method.internalCall!(locale, []) as ObjectValue;
  assert.equal(first.prototype, own.realm.arrayPrototype);
  assert.notEqual(first, second);
  assert.deepEqual(values(first), ["buddhist", "gregory"]);
  objects.createDataProperty(first, "0", "corrupted", own.hooks);
  assert.deepEqual(values(second), ["buddhist", "gregory"]);
  const enumeration = objects.getOwnProperty(own.intl, "supportedValuesOf")!
    .value as ObjectValue;
  const supported = values(
    enumeration.internalCall!(undefined, ["calendar"]) as ObjectValue,
  );
  assert.ok(supported.includes("buddhist"));
  assert.deepEqual(supported, [...new Set(supported)].sort());
});
test("calendar methods require the actual Locale internal slot", () => {
  const r = setup(),
    locale = r.locale("en");
  for (const receiver of [
    undefined,
    null,
    19,
    "en",
    r.prototype,
    objects.createObject(locale),
  ]) {
    let caught: unknown;
    try {
      r.method.internalCall!(receiver, []);
    } catch (error) {
      caught = error;
    }
    assert.equal(
      objects.viewObjectValue(caught, r.root)?.prototype,
      r.realm.prototypes.get("type"),
    );
  }
});

test("Locale collation methods preserve keywords, metadata, brands and method-realm arrays", () => {
  const own = setup("getCollations"),
    foreign = setup("getCollations");
  assert.equal(
    objects.getOwnProperty(own.method, "name")!.value,
    "getCollations",
  );
  assert.equal(objects.getOwnProperty(own.method, "length")!.value, 0);
  assert.equal(own.method.internalConstruct, undefined);
  for (const [tag, expected] of [
    ["en-u-co-true", [""]],
    ["en-u-co", [""]],
    ["en-u-co-foobar", ["foobar"]],
    ["de", ["emoji", "eor", "phonebk"]],
  ] as const) {
    const locale = foreign.locale(tag);
    const first = own.method.internalCall!(locale, []) as ObjectValue;
    const second = own.method.internalCall!(locale, []) as ObjectValue;
    assert.deepEqual(values(first), expected);
    assert.equal(first.prototype, own.realm.arrayPrototype);
    assert.notEqual(first, second);
    objects.createDataProperty(first, "0", "changed", own.hooks);
    assert.deepEqual(values(second), expected);
  }
  for (const receiver of [
    undefined,
    null,
    "de",
    own.prototype,
    objects.createObject(own.locale("de")),
  ]) {
    let caught: unknown;
    try {
      own.method.internalCall!(receiver, []);
    } catch (error) {
      caught = error;
    }
    assert.equal(
      objects.viewObjectValue(caught, own.root)?.prototype,
      own.realm.prototypes.get("type"),
    );
  }
});
