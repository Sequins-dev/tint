import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  defineOwnProperty,
  getOwnProperty,
  preventExtensions,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import {
  createMutableBinding,
  initializeBinding,
} from "@tint/js-runtime/environments/records";
import * as globals from "../src/environments/global/index.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) => Reflect.apply(fn as Function, receiver, args),
};
function setup() {
  const object = createObject<string, unknown>(undefined);
  return {
    object,
    record: globals.createGlobalEnvironment(
      object,
      object,
      { globalThis: true },
      (name: string) => name,
      hooks,
    ),
  };
}
test("global lexical bindings shadow object properties and retain their own TDZ", () => {
  assert.equal(typeof globals.createGlobalEnvironment, "function");
  const { object, record } = setup();
  assert.equal(globals.createGlobalVarBinding(record, "x", false), "none");
  assert.equal(globals.setGlobalBinding(record, "x", 1, true), "none");
  createMutableBinding(record.lexical, "x", false);
  assert.equal(globals.hasGlobalBinding(record, "x"), true);
  assert.equal(globals.getGlobalBinding(record, "x", false).error, "reference");
  initializeBinding(record.lexical, "x", 2);
  assert.equal(globals.getGlobalBinding(record, "x", true).value, 2);
  assert.equal(getOwnProperty(object, "x")?.value, 1);
  assert.equal(globals.setGlobalBinding(record, "x", 3, true), "none");
  assert.equal(globals.getGlobalBinding(record, "x", true).value, 3);
  assert.equal(globals.deleteGlobalBinding(record, "x"), false);
  assert.deepEqual(record.thisValue, { globalThis: true });
});
test("global declaration admission respects descriptor attributes and extensibility", () => {
  for (let flags = 0; flags < 16; flags++) {
    const { object, record } = setup();
    const accessor = (flags & 8) !== 0,
      writable = (flags & 1) !== 0,
      enumerable = (flags & 2) !== 0,
      configurable = (flags & 4) !== 0;
    defineOwnProperty(
      object,
      "x",
      {
        ...emptyUpdate(undefined),
        fields: accessor ? 52 : 51,
        value: 1,
        get: () => 1,
        writable,
        enumerable,
        configurable,
      },
      hooks,
    );
    preventExtensions(object);
    assert.equal(
      globals.hasRestrictedGlobalProperty(record, "x"),
      !configurable,
    );
    assert.equal(globals.canDeclareGlobalVar(record, "x"), true);
    assert.equal(
      globals.canDeclareGlobalFunction(record, "x"),
      configurable || (!accessor && writable && enumerable),
    );
    assert.equal(globals.canDeclareGlobalVar(record, "missing"), false);
    assert.equal(globals.canDeclareGlobalFunction(record, "missing"), false);
  }
});
test("global var redeclaration preserves values and function declarations replace configurable accessors", () => {
  const { object, record } = setup();
  defineOwnProperty(
    object,
    "x",
    {
      ...emptyUpdate(undefined),
      fields: 52,
      get: () => 7,
      enumerable: true,
      configurable: true,
    },
    hooks,
  );
  assert.equal(globals.createGlobalVarBinding(record, "x", false), "none");
  assert.equal(globals.getGlobalBinding(record, "x", true).value, 7);
  assert.equal(
    globals.createGlobalFunctionBinding(record, "x", 42, false),
    "none",
  );
  const descriptor = getOwnProperty(object, "x")!;
  assert.equal(descriptor.accessor, false);
  assert.equal(descriptor.value, 42);
  assert.equal(descriptor.writable && descriptor.enumerable, true);
  assert.equal(descriptor.configurable, false);
  assert.equal(globals.deleteGlobalBinding(record, "x"), false);
  assert.equal(
    globals.createGlobalVarBinding(record, "deletable", true),
    "none",
  );
  assert.equal(globals.deleteGlobalBinding(record, "deletable"), true);
});
test("global object reads and writes distinguish missing names and read-only properties", () => {
  const { object, record } = setup();
  assert.equal(
    globals.getGlobalBinding(record, "missing", true).error,
    "reference",
  );
  assert.deepEqual(globals.getGlobalBinding(record, "missing", false), {
    error: "none",
    value: undefined,
  });
  assert.equal(
    globals.setGlobalBinding(record, "missing", 1, true),
    "reference",
  );
  assert.equal(globals.setGlobalBinding(record, "missing", 1, false), "none");
  assert.equal(globals.getGlobalBinding(record, "missing", true).value, 1);
  defineOwnProperty(
    object,
    "fixed",
    { ...emptyUpdate(undefined), fields: 1, value: 2 },
    hooks,
  );
  assert.equal(globals.setGlobalBinding(record, "fixed", 3, true), "type");
  assert.equal(globals.setGlobalBinding(record, "fixed", 3, false), "none");
  assert.equal(globals.getGlobalBinding(record, "fixed", true).value, 2);
});
