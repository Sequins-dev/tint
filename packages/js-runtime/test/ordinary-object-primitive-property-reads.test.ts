import assert from "node:assert/strict";
import { after, test } from "node:test";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";

const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");

function setup() {
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
  objects.installArrayIntrinsics(root, realm, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  function read(value: unknown, key: ScriptPropertyKey): unknown {
    const result = objects.getObjectValueProperty(value, key, hooks, realm);
    assert.equal(result.error, "none");
    return result.value;
  }
  return { root, hooks, realm, read };
}

test("string primitive reads answer length and indices without boxing every character", () => {
  const f = setup();
  const text = "ab".repeat(100000);
  const started = performance.now();
  for (let i = 0; i < 5; i++) {
    assert.equal(f.read(text, "length"), 200000);
    assert.equal(f.read(text, "199999"), "b");
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `five reads of a 200k string took ${elapsed}ms`);
});

test("string primitive reads follow String exotic own properties then the prototype", () => {
  const f = setup();
  assert.equal(f.read("abc", "length"), 3);
  assert.equal(f.read("abc", "0"), "a");
  assert.equal(f.read("abc", "2"), "c");
  assert.equal(f.read("", "length"), 0);
  assert.equal(f.read("abc", "3"), undefined);
  assert.equal(f.read("abc", "01"), undefined);
  assert.equal(f.read("abc", "-0"), undefined);
  assert.equal(f.read("\u{1F600}", "1"), "\uDE00");
  assert.equal(typeof f.read("abc", "charAt"), "object");
  assert.equal(
    f.read("abc", "charAt"),
    objects.getOwnProperty(f.realm.stringPrototype, "charAt")!.value,
  );
  // Indices at or above length and non-canonical keys are inherited.
  for (const key of ["3", "01"])
    objects.createDataProperty(
      f.realm.stringPrototype,
      key,
      "inherited",
      f.hooks,
    );
  assert.equal(f.read("abc", "3"), "inherited");
  assert.equal(f.read("abc", "01"), "inherited");
  assert.equal(f.read("abc", "1"), "b");
  objects.createDataProperty(f.realm.stringPrototype, "length", 99, f.hooks);
  assert.equal(f.read("abc", "length"), 3);
});

test("inherited primitive getters receive the primitive itself", () => {
  const f = setup();
  const seen: unknown[] = [];
  const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    (receiver) => {
      seen.push(receiver);
      return "got";
    },
  );
  for (const prototype of [
    f.realm.stringPrototype,
    f.realm.numberPrototype,
    f.realm.booleanPrototype,
    f.realm.objectPrototype,
  ])
    assert.equal(
      objects.defineOwnProperty(
        prototype,
        prototype === f.realm.objectPrototype ? "inheritedFromObject" : "probe",
        {
          ...emptyUpdate<unknown>(undefined),
          fields: 4 | 16 | 32,
          get: getter,
          enumerable: false,
          configurable: true,
        },
        f.hooks,
      ),
      "accepted",
    );
  assert.equal(f.read("text", "probe"), "got");
  assert.equal(f.read(1.5, "probe"), "got");
  assert.equal(f.read(false, "probe"), "got");
  assert.equal(f.read("text", "inheritedFromObject"), "got");
  assert.equal(f.read(7, "inheritedFromObject"), "got");
  assert.deepEqual(seen, ["text", 1.5, false, "text", 7]);
});

test("number, boolean and symbol primitive reads use their prototypes", () => {
  const f = setup();
  const symbol = objects.createSymbolValue("s");
  for (const [prototype, marker] of [
    [f.realm.numberPrototype, "number"],
    [f.realm.booleanPrototype, "boolean"],
    [f.realm.symbolPrototype, "symbol"],
  ] as const)
    objects.createDataProperty(prototype, "probe", marker, f.hooks);
  assert.equal(f.read(1, "probe"), "number");
  assert.equal(f.read(NaN, "probe"), "number");
  assert.equal(f.read(true, "probe"), "boolean");
  assert.equal(f.read(symbol, "probe"), "symbol");
  assert.equal(f.read(1, "length"), undefined);
  assert.equal(f.read(1, "0"), undefined);
  for (const base of [null, undefined]) {
    const result = objects.getObjectValueProperty(base, "x", f.hooks, f.realm);
    assert.equal(result.error, "type");
  }
});
