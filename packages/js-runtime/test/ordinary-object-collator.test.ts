import type * as Objects from "../src/objects/index.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
function setup() {
  const global = o.createObject<Objects.ScriptPropertyKey, unknown>(undefined);
  const hooks: Objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = o.callObjectValue(callee, receiver, args, global);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = o.createErrorRealm(global, hooks);
  o.installPrimitiveIntrinsics(global, realm, hooks);
  o.installIntlIntrinsics(global, realm, hooks);
  function get(value: unknown, key: Objects.ScriptPropertyKey): unknown {
    const result = o.getObjectValueProperty(value, key, hooks, realm);
    assert.equal(result.error, "none");
    return result.value;
  }
  function object(value: unknown) {
    const result = o.viewObjectValue(value, global);
    assert.ok(result);
    return result;
  }
  function call(
    value: unknown,
    receiver: unknown,
    args: readonly unknown[] = [],
  ) {
    return hooks.call(value, receiver, args);
  }
  function record(values: Record<string, unknown>) {
    const result = o.createObject<Objects.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    for (const [key, value] of Object.entries(values))
      o.createDataProperty(result, key, value, hooks);
    return result;
  }
  function getter(value: unknown, key: string, read: () => unknown) {
    const object_ = object(value),
      fn = o.createCallableObject<Objects.ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        read,
      );
    assert.equal(
      o.defineOwnProperty(
        object_,
        key,
        {
          ...emptyUpdate<unknown>(undefined),
          fields: 36,
          get: fn,
          configurable: true,
        },
        hooks,
      ),
      "accepted",
    );
  }
  const constructor = get(get(global, "Intl"), "Collator");
  assert.ok(constructor, "Collator is installed");
  function create(locale: unknown = "en", options: unknown = undefined) {
    return object(call(constructor, undefined, [locale, options]));
  }
  function resolved(value: unknown) {
    const result = call(get(value, "resolvedOptions"), value);
    return Object.fromEntries(
      [
        "locale",
        "usage",
        "sensitivity",
        "ignorePunctuation",
        "collation",
        "numeric",
        "caseFirst",
      ].map((key) => [key, get(result, key)]),
    );
  }
  function compare(value: unknown, a: unknown, b: unknown) {
    return call(get(value, "compare"), undefined, [a, b]);
  }
  return {
    global,
    realm,
    hooks,
    get,
    object,
    call,
    record,
    getter,
    constructor,
    create,
    resolved,
    compare,
  };
}
test("Collator constructor, prototype, accessor and bound function descriptors", () => {
  const f = setup(),
    ctor = f.object(f.constructor),
    prototype = f.object(f.get(ctor, "prototype")),
    instance = f.create();
  assert.equal(f.get(ctor, "length"), 0);
  assert.equal(f.get(ctor, "name"), "Collator");
  assert.equal(o.getOwnProperty(ctor, "prototype")?.writable, false);
  assert.equal(instance.prototype, prototype);
  assert.equal(instance.extensible, true);
  assert.equal(
    f.get(prototype, o.wellKnownSymbol(f.realm.symbolRegistry, "toStringTag")),
    "Intl.Collator",
  );
  const descriptor = o.getOwnProperty(prototype, "compare");
  assert.equal(descriptor?.enumerable, false);
  assert.equal(descriptor?.configurable, true);
  assert.equal(descriptor?.set, undefined);
  assert.equal(f.get(descriptor?.get, "name"), "get compare");
  assert.equal(f.get(descriptor?.get, "length"), 0);
  const compare = f.object(f.get(instance, "compare"));
  assert.equal(f.get(instance, "compare"), compare);
  assert.notEqual(f.get(f.create(), "compare"), compare);
  assert.equal(f.get(compare, "name"), "");
  assert.equal(f.get(compare, "length"), 2);
  assert.equal(compare.internalConstruct, undefined);
  assert.equal(o.getOwnProperty(compare, "prototype"), undefined);
  assert.throws(
    () => f.call(descriptor?.get, prototype),
    (error) =>
      o.viewObjectValue(error, f.global)?.prototype ===
      f.realm.prototypes.get("type"),
  );
  const inherited = o.createObject(instance);
  assert.throws(() => f.get(inherited, "compare"));
  const called = f.object(f.call(f.constructor, instance, ["de"]));
  assert.notEqual(called, instance);
  assert.equal(f.resolved(called).locale, "de");
  assert.equal(f.resolved(instance).locale, "en");
});
test("Collator locale extensions and explicit options resolve independently", () => {
  const f = setup();
  for (const [locale, options, expected] of [
    [
      "de-u-co-phonebk",
      { collation: "pinyin" },
      { locale: "de-u-co-phonebk", collation: "phonebk" },
    ],
    [
      "en-u-co-phonebk",
      { collation: "pinyin" },
      { locale: "en", collation: "default" },
    ],
    [
      "de-u-co-phonebk",
      { collation: "eor" },
      { locale: "de", collation: "eor" },
    ],
    [
      "de-u-co-phonebk",
      { collation: "phonebk" },
      { locale: "de-u-co-phonebk", collation: "phonebk" },
    ],
    ["en-u-kn-false", { numeric: true }, { locale: "en", numeric: true }],
    ["en-u-kn", { numeric: true }, { locale: "en-u-kn", numeric: true }],
    [
      "en-u-kf-upper",
      { caseFirst: "lower" },
      { locale: "en", caseFirst: "lower" },
    ],
    [
      "en-u-kf-upper",
      { caseFirst: "upper" },
      { locale: "en-u-kf-upper", caseFirst: "upper" },
    ],
    [
      "de-u-co-phonebk",
      { usage: "search" },
      { locale: "de", collation: "default", usage: "search" },
    ],
  ] as const) {
    const result = f.resolved(f.create(locale, f.record(options)));
    for (const [key, value] of Object.entries(expected))
      assert.equal(
        result[key],
        value,
        JSON.stringify({ locale, options, key }),
      );
  }
  assert.equal(f.resolved(f.create("th")).ignorePunctuation, true);
  assert.equal(f.resolved(f.create()).sensitivity, "variant");
});
test("Collator compares actual root and tailored collation elements with options", () => {
  const f = setup();
  assert.ok(Number(f.compare(f.create(), "a", "b")) < 0);
  assert.equal(f.compare(f.create(), "ä\u0323", "a\u0323\u0308"), 0);
  assert.ok(Number(f.compare(f.create("de"), "Ä", "AE")) < 0);
  assert.ok(
    Number(
      f.compare(f.create("de", f.record({ usage: "search" })), "Ä", "AE"),
    ) > 0,
  );
  assert.ok(Number(f.compare(f.create("de-u-co-phonebk"), "Ä", "Af")) < 0);
  for (const sensitivity of ["base", "accent", "case", "variant"]) {
    const value = f.create("en", f.record({ sensitivity }));
    assert.equal(
      f.compare(value, "Aa", "Aã") === 0,
      sensitivity === "base" || sensitivity === "case",
    );
    assert.equal(
      f.compare(value, "Aa", "aA") === 0,
      sensitivity === "base" || sensitivity === "accent",
    );
  }
  assert.ok(
    Number(f.compare(f.create("en", f.record({ numeric: true })), "9", "10")) <
      0,
  );
  assert.equal(
    f.compare(f.create("en", f.record({ numeric: true })), "000٢", "２"),
    0,
  );
  assert.ok(
    Number(
      f.compare(f.create("en", f.record({ caseFirst: "upper" })), "A", "a"),
    ) < 0,
  );
  assert.equal(
    f.compare(
      f.create("en", f.record({ ignorePunctuation: true })),
      "a- b",
      "ab",
    ),
    0,
  );
});
test("Collator observes option order once and bound compare converts left before right", () => {
  const f = setup(),
    events: string[] = [],
    options = f.record({});
  for (const key of [
    "usage",
    "localeMatcher",
    "collation",
    "numeric",
    "caseFirst",
    "sensitivity",
    "ignorePunctuation",
  ])
    f.getter(options, key, () => {
      events.push(key);
      return undefined;
    });
  const value = f.create("en", options);
  assert.deepEqual(events, [
    "usage",
    "localeMatcher",
    "collation",
    "numeric",
    "caseFirst",
    "sensitivity",
    "ignorePunctuation",
  ]);
  events.length = 0;
  const left = f.record({}),
    right = f.record({});
  for (const [object, label] of [
    [left, "left"],
    [right, "right"],
  ] as const)
    o.createDataProperty(
      object,
      "toString",
      o.createCallableObject<Objects.ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          events.push(label);
          return "a";
        },
      ),
      f.hooks,
    );
  assert.equal(f.compare(value, left, right), 0);
  assert.deepEqual(events, ["left", "right"]);
  for (const [key, bad] of [
    ["usage", "bad"],
    ["localeMatcher", "bad"],
    ["collation", "ab"],
    ["caseFirst", "bad"],
    ["sensitivity", "bad"],
  ] as const)
    assert.throws(() => f.create("en", f.record({ [key]: bad })));
  assert.throws(() => f.create("en", null));
  assert.throws(() => f.create("en", 1));
  const marker = {};
  f.getter(options, "usage", () => {
    throw marker;
  });
  assert.throws(
    () => f.create("en", options),
    (error) => error === marker,
  );
});
test("String.localeCompare descriptors and coercion precede locale option access", () => {
  const f = setup(),
    descriptor = o.getOwnProperty(f.realm.stringPrototype, "localeCompare");
  assert.equal(descriptor?.writable, true);
  assert.equal(descriptor?.enumerable, false);
  assert.equal(descriptor?.configurable, true);
  assert.equal(f.get(descriptor?.value, "length"), 1);
  assert.equal(f.get(descriptor?.value, "name"), "localeCompare");
  assert.ok(
    Number(f.call(descriptor?.value, "ä", ["af", "de-u-co-phonebk"])) < 0,
  );
  const events: string[] = [],
    receiver = f.record({}),
    that = f.record({}),
    options = f.record({});
  for (const [value, name] of [
    [receiver, "receiver"],
    [that, "that"],
  ] as const)
    o.createDataProperty(
      value,
      "toString",
      o.createCallableObject<Objects.ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          events.push(name);
          return "a";
        },
      ),
      f.hooks,
    );
  f.getter(options, "usage", () => {
    events.push("usage");
    return undefined;
  });
  assert.equal(f.call(descriptor?.value, receiver, [that, "en", options]), 0);
  assert.deepEqual(events, ["receiver", "that", "usage"]);
  events.length = 0;
  assert.throws(() => f.call(descriptor?.value, null, [that, "en", options]));
  assert.deepEqual(events, []);
});
