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
  objects.installRegExpIntrinsics(root, realm, hooks);
  return { root, hooks, realm };
}

for (const name of [
  "match",
  "matchAll",
  "search",
  "replace",
  "replaceAll",
  "split",
]) {
  test(`String.${name} ignores primitive prototype symbol getters`, () => {
    const f = setup();
    const key = objects.wellKnownSymbol(
      f.realm.symbolRegistry,
      name === "replaceAll" ? "replace" : name,
    );
    const marker = new Error("primitive prototype symbol getter was called");
    const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        throw marker;
      },
    );
    const method = objects.getOwnProperty(f.realm.stringPrototype, name)!.value;
    function read(value: unknown, key: ScriptPropertyKey): unknown {
      const result = objects.getObjectValueProperty(
        value,
        key,
        f.hooks,
        f.realm,
      );
      assert.equal(result.error, "none");
      return result.value;
    }
    for (const row of [
      { value: 1, needle: "1", prototype: f.realm.numberPrototype },
      { value: true, needle: "true", prototype: f.realm.booleanPrototype },
      { value: "1", needle: "1", prototype: f.realm.stringPrototype },
      {
        value: objects.createBigIntLiteral("1"),
        needle: "1",
        prototype: f.realm.bigIntPrototype,
      },
    ]) {
      assert.equal(
        objects.defineOwnProperty(
          row.prototype,
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
      const input = `a${row.needle}b${row.needle}c`;
      const args = name.startsWith("replace") ? [row.value, "X"] : [row.value];
      const result = f.hooks.call(method, input, args);
      if (name === "search") assert.equal(result, 1);
      else if (name === "replace") assert.equal(result, `aXb${row.needle}c`);
      else if (name === "replaceAll") assert.equal(result, "aXbXc");
      else if (name === "split") {
        assert.equal(read(result, "length"), 3);
        assert.deepEqual(
          [read(result, "0"), read(result, "1"), read(result, "2")],
          ["a", "b", "c"],
        );
      } else {
        const match =
          name === "matchAll"
            ? read(f.hooks.call(read(result, "next"), result, []), "value")
            : result;
        assert.equal(read(match, "0"), row.needle);
        assert.equal(read(match, "index"), 1);
        assert.equal(read(match, "input"), input);
      }
      const boxed = objects.toObjectValue(row.value, f.realm, f.hooks);
      const boxedArgs = name.startsWith("replace") ? [boxed, "X"] : [boxed];
      assert.throws(
        () => f.hooks.call(method, input, boxedArgs),
        (error) => error === marker,
      );
    }
  });
}
