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
  o.installTemporalIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "DurationFormat")?.value as Obj;
  assert.ok(constructor, "DurationFormat is installed");
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
test("DurationFormat metadata, defaults and property order", () => {
  const r = setup(),
    f = r.make();
  assert.equal(r.get(r.constructor, "name"), "DurationFormat");
  assert.equal(r.get(r.constructor, "length"), 0);
  r.type(() => r.constructor.internalCall!(undefined, []), "type");
  const resolved = r.call("resolvedOptions", f) as Obj;
  const names = [
    "years",
    "months",
    "weeks",
    "days",
    "hours",
    "minutes",
    "seconds",
    "milliseconds",
    "microseconds",
    "nanoseconds",
  ];
  assert.deepEqual(
    [...resolved.properties.keys()],
    [
      "locale",
      "numberingSystem",
      "style",
      ...names.flatMap((name) => [name, name + "Display"]),
    ],
  );
  assert.equal(r.get(resolved, "style"), "short");
  for (const name of names) {
    assert.equal(r.get(resolved, name), "short");
    assert.equal(r.get(resolved, name + "Display"), "auto");
  }
  for (const [name, length] of [
    ["format", 1],
    ["formatToParts", 1],
    ["resolvedOptions", 0],
  ] as const) {
    const method = r.get(r.prototype, name) as Obj;
    assert.equal(r.get(method, "length"), length);
    assert.equal(method.internalConstruct, undefined);
    for (const receiver of [undefined, null, 0, r.prototype, o.createObject(f)])
      r.type(() => r.call(name, receiver), "type");
  }
});
test("DurationFormat coerces fields alphabetically and validates duration records", () => {
  const r = setup(),
    f = r.make("en", r.options({ style: "digital", fractionalDigits: 3 }));
  assert.equal(r.call("format", f, ["PT1H2M3.004005006S"]), "1:02:03.004");
  for (const input of [undefined, null, 1, true])
    r.type(() => r.call("format", f, [input]), "type");
  for (const fields of [
    { days: 1, hours: -1 },
    { hours: 1.5 },
    { seconds: Infinity },
    { years: 4294967296 },
  ])
    r.type(() => r.call("format", f, [r.options(fields)]), "range");
  r.type(() => r.call("format", f, [r.options({})]), "type");
  const events: string[] = [],
    bag = r.options({});
  for (const name of [
    "days",
    "hours",
    "microseconds",
    "milliseconds",
    "minutes",
    "months",
    "nanoseconds",
    "seconds",
    "weeks",
    "years",
  ]) {
    o.defineOwnProperty(
      bag,
      name,
      {
        fields: 60, value: undefined, writable: false, set: undefined, enumerable: true,
        get: o.createCallableObject(r.realm.functionPrototype, () => {
          events.push(name);
          return name === "seconds" ? 1 : undefined;
        }),
        configurable: true,
      },
      r.hooks,
    );
  }
  assert.equal(r.call("format", f, [bag]), "0:00:01.000");
  assert.deepEqual(events, [
    "days",
    "hours",
    "microseconds",
    "milliseconds",
    "minutes",
    "months",
    "nanoseconds",
    "seconds",
    "weeks",
    "years",
  ]);
});
test("DurationFormat part objects belong to the method realm and distinguish separators", () => {
  const r = setup(),
    foreign = setup(),
    f = foreign.make("en", foreign.options({ style: "digital" })),
    a = r.call("formatToParts", f, ["PT1H2M3S"]) as Obj;
  assert.equal(a.prototype, r.realm.arrayPrototype);
  assert.equal(r.get(a, "length"), 5);
  for (let i = 0; i < 5; i++) {
    const part = r.get(a, String(i)) as Obj;
    assert.equal(part.prototype, r.realm.objectPrototype);
    assert.equal(
      r.get(part, "unit"),
      i % 2 === 1
        ? undefined
        : i === 0
          ? "hour"
          : i === 2
            ? "minute"
            : "second",
    );
  }
});
test("Temporal.Duration locale strings use the private duration service and brands", () => {
  const r = setup(),
    temporal = r.get(r.root, "Temporal") as Obj,
    ctor = r.get(temporal, "Duration") as Obj,
    duration = ctor.internalConstruct!(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      ctor,
    ) as Obj,
    method = r.get(duration, "toLocaleString") as Obj;
  const expected = r.call(
    "format",
    r.make("en", r.options({ style: "long" })),
    [duration],
  );
  assert.equal(
    method.internalCall!(duration, ["en", r.options({ style: "long" })]),
    expected,
  );
  r.type(() => method.internalCall!(r.options({ years: 1 }), []), "type");
  const publicCtor = r.constructor;
  o.createDataProperty(r.intl, "DurationFormat", 0, r.hooks);
  assert.equal(
    method.internalCall!(duration, ["en", r.options({ style: "long" })]),
    expected,
  );
  o.createDataProperty(r.intl, "DurationFormat", publicCtor, r.hooks);
});
