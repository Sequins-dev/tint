import assert from "node:assert/strict";
import { after, test } from "node:test";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";

const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");
function setup(name: string) {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
  assert.ok(descriptor, name + " must be installed");
  const method = objects.viewObjectValue(descriptor.value, root);
  assert.ok(method?.internalCall);
  return {
    root,
    realm,
    hooks,
    descriptor,
    method,
    call(receiver: unknown, ...args: unknown[]) {
      return method.internalCall!(receiver, args);
    },
    error(kind: string) {
      return (error: unknown) =>
        objects.viewObjectValue(error, root)?.prototype ===
        realm.prototypes.get(kind as "range" | "type");
    },
  };
}
const cases = [
  ["Iİiı", "en", "ii\u0307iı", "IİII"],
  ["Iİiı", "tr", "ıiiı", "IİİI"],
  ["Iİiı", "az", "ıiiı", "IİİI"],
  ["I\u0307", "tr-Latn-TR-u-kn", "i", "I\u0307"],
  ["I\u0323\u0307", "tr", "i\u0323", "I\u0323\u0307"],
  ["I\u0301\u0307", "tr", "ı\u0301\u0307", "I\u0301\u0307"],
  [
    "I\u0301J\u0300Į\u0303",
    "lt",
    "i\u0307\u0301j\u0307\u0300į\u0307\u0303",
    "I\u0301J\u0300Į\u0303",
  ],
  ["ÌÍĨ", "lt", "i\u0307\u0300i\u0307\u0301i\u0307\u0303", "ÌÍĨ"],
  ["i\u0307j\u0323\u0307", "lt", "i\u0307j\u0323\u0307", "IJ\u0323"],
  ["i\u0301\u0307", "lt", "i\u0301\u0307", "I\u0301\u0307"],
  ["ΟΣ", "tr", "ος", "ΟΣ"],
  ["\ud800I\udc00", "tr", "\ud800ı\udc00", "\ud800I\udc00"],
] as const;
for (const name of ["toLocaleLowerCase", "toLocaleUpperCase"] as const) {
  test(`${name} has standard function and property descriptors`, () => {
    const f = setup(name);
    assert.equal(f.descriptor.writable, true);
    assert.equal(f.descriptor.enumerable, false);
    assert.equal(f.descriptor.configurable, true);
    assert.equal(objects.getOwnProperty(f.method, "length")?.value, 0);
    assert.equal(objects.getOwnProperty(f.method, "name")?.value, name);
    assert.equal(f.method.internalConstruct, undefined);
    assert.equal(objects.getOwnProperty(f.method, "prototype"), undefined);
  });
  test(`${name} follows full Unicode and Turkish, Azeri and Lithuanian contexts`, () => {
    const f = setup(name);
    for (const [text, locale, lower, upper] of cases)
      assert.equal(
        f.call(text, locale),
        name === "toLocaleLowerCase" ? lower : upper,
        JSON.stringify({ text, locale }),
      );
    assert.equal(f.call("I"), name === "toLocaleLowerCase" ? "i" : "I");
    assert.equal(f.call("I", "TR"), name === "toLocaleLowerCase" ? "ı" : "I");
  });
  test(`${name} coerces its receiver before reading every locale and uses the first`, () => {
    const f = setup(name),
      events: string[] = [];
    const receiver = objects.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
    objects.createDataProperty(
      receiver,
      "toString",
      objects.createCallableObject<ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          events.push("receiver");
          return "I";
        },
      ),
      f.hooks,
    );
    const locales = objects.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
    for (const [key, value] of [
      ["length", 2],
      ["0", "en"],
      ["1", "tr"],
    ] as const) {
      const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          events.push(key);
          return value;
        },
      );
      assert.equal(
        objects.defineOwnProperty(
          locales,
          key,
          {
            ...emptyUpdate<unknown>(undefined),
            fields: 36,
            get: getter,
            configurable: true,
          },
          f.hooks,
        ),
        "accepted",
      );
    }
    assert.equal(
      f.call(receiver, locales),
      name === "toLocaleLowerCase" ? "i" : "I",
    );
    assert.deepEqual(events, ["receiver", "length", "0", "1"]);
    for (const value of [undefined, null])
      assert.throws(() => f.call(value, "invalid_locale"), f.error("type"));
    assert.throws(() => f.call("I", "invalid_locale"), f.error("range"));
    objects.createDataProperty(locales, "1", "invalid_locale", f.hooks);
    assert.throws(() => f.call("I", locales), f.error("range"));
  });
}

test("locale casing agrees with independent Unicode contexts across combining boundaries", () => {
  const bases = [
    "I",
    "J",
    "Į",
    "i",
    "j",
    "į",
    "İ",
    "ı",
    "Ì",
    "Í",
    "Ĩ",
    "𝑖",
    "𝑗",
  ];
  const marks = [
    "",
    "\u0307",
    "\u0323",
    "\u0301",
    "\u0323\u0307",
    "\u0301\u0307",
    "\u0307\u0307",
    "\u0323\u0301\u0307",
    "\ud800\u0307",
    "😀\u0307",
  ];
  for (const name of ["toLocaleLowerCase", "toLocaleUpperCase"] as const) {
    const f = setup(name);
    for (const locale of ["tr", "az", "lt"])
      for (const base of bases)
        for (const mark of marks)
          for (const tail of ["", "A", "Σ", "\u0301A"]) {
            const text = base + mark + tail;
            assert.equal(
              f.call(text, locale),
              text[name](locale),
              JSON.stringify({ name, text, locale }),
            );
          }
  }
});
