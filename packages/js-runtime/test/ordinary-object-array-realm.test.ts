import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
import { emptyUpdate, valueField } from "@tint/js-runtime/descriptors";

test("array length failures use the active realm instead of the array's realm", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const caller = objects.createErrorRealm(root, hooks);
  const foreign = objects.createErrorRealm(
    objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
    hooks,
    caller.symbolRegistry,
    caller.agent,
  );
  const array = objects.createArrayObject<objects.ScriptPropertyKey, unknown>(
    0,
    foreign.arrayPrototype,
    foreign.arrayHooks,
    hooks,
  );
  function fail() {
    objects.defineOwnProperty(
      array,
      "length",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: valueField,
        value: 4294967296,
      },
      hooks,
    );
  }
  objects.runScriptContext(
    caller.agent,
    { realm: caller, scriptOrModule: undefined },
    () => {
      assert.throws(
        fail,
        (error: unknown) =>
          (error as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>)
            .prototype === caller.prototypes.get("range"),
      );
    },
  );
  objects.runScriptContext(
    caller.agent,
    { realm: foreign, scriptOrModule: undefined },
    () => {
      assert.throws(
        fail,
        (error: unknown) =>
          (error as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>)
            .prototype === foreign.prototypes.get("range"),
      );
    },
  );
});
