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
  const constructor = o.getOwnProperty(intl, "RelativeTimeFormat")
    ?.value as Obj;
  assert.ok(constructor, "RelativeTimeFormat is installed");
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
    const r = o.constructObjectValue(constructor, [locale, input], root);
    assert.equal(r.error, "none");
    return r.value as Obj;
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
test("RelativeTimeFormat exposes standard metadata and immutable configured slots", () => {
  const r = setup();
  assert.equal(r.get(r.constructor, "name"), "RelativeTimeFormat");
  assert.equal(r.get(r.constructor, "length"), 0);
  r.type(() => r.constructor.internalCall!(undefined, []), "type");
  const options = r.options({
      numeric: "auto",
      style: "short",
      numberingSystem: "deva",
    }),
    f = r.make("en-US", options);
  o.createDataProperty(options, "numeric", "always", r.hooks);
  assert.equal(r.call("format", f, [-1, "day"]), "yesterday");
  const resolved = r.call("resolvedOptions", f) as Obj;
  for (const [key, value] of Object.entries({
    locale: "en-US",
    style: "short",
    numeric: "auto",
    numberingSystem: "deva",
  }))
    assert.equal(r.get(resolved, key), value);
  for (const [name, length] of [
    ["format", 2],
    ["formatToParts", 2],
    ["resolvedOptions", 0],
  ] as const) {
    const method = r.get(r.prototype, name) as Obj;
    assert.equal(r.get(method, "name"), name);
    assert.equal(r.get(method, "length"), length);
    assert.equal(method.internalConstruct, undefined);
    const d = o.getOwnProperty(r.prototype, name)!;
    assert.equal(d.enumerable, false);
    assert.equal(d.writable, true);
    assert.equal(d.configurable, true);
  }
});
test("RelativeTimeFormat brands receivers, rejects invalid options and coerces both inputs before range checking", () => {
  const r = setup(),
    f = r.make();
  for (const receiver of [undefined, null, 0, r.prototype, o.createObject(f)])
    r.type(() => r.call("format", receiver, [1, "day"]), "type");
  for (const input of [null]) r.type(() => r.make("en", input), "type");
  for (const fields of [
    { style: "wide" },
    { numeric: "sometimes" },
    { numberingSystem: "bad_value" },
    { localeMatcher: "invalid" },
  ])
    r.type(() => r.make("en", r.options(fields)), "range");
  const events: string[] = [];
  const value = o.createObject<ScriptPropertyKey, unknown>(
      r.realm.objectPrototype,
    ),
    unit = o.createObject<ScriptPropertyKey, unknown>(r.realm.objectPrototype);
  o.createDataProperty(
    value,
    "valueOf",
    o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        events.push("number");
        return Infinity;
      },
    ),
    r.hooks,
  );
  o.createDataProperty(
    unit,
    "toString",
    o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        events.push("unit");
        return "day";
      },
    ),
    r.hooks,
  );
  r.type(() => r.call("format", f, [value, unit]), "range");
  assert.deepEqual(events, ["number", "unit"]);
});
test("relative part arrays and objects use the method realm and omit literal unit properties", () => {
  const r = setup(),
    foreign = setup(),
    f = foreign.make("en"),
    a = r.call("formatToParts", f, [-1, "days"]) as Obj,
    b = r.call("formatToParts", f, [-1, "days"]) as Obj;
  assert.equal(a.prototype, r.realm.arrayPrototype);
  assert.notEqual(a, b);
  assert.equal(r.get(a, "length"), 2);
  const number = r.get(a, "0") as Obj,
    literal = r.get(a, "1") as Obj;
  assert.equal(number.prototype, r.realm.objectPrototype);
  assert.equal(r.get(number, "unit"), "day");
  assert.equal(r.get(number, "value"), "1");
  assert.equal(o.getOwnProperty(literal, "unit"), undefined);
});
