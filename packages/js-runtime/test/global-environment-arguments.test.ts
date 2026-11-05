import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  getOwnProperty,
  setProperty,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import {
  createDeclarativeEnvironment,
  createMutableBinding,
  initializeBinding,
  getBindingValue,
  setMutableBinding,
  hasBinding,
} from "@tint/js-runtime/environments/records";
import * as runtime from "../src/environments/global/index.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const intrinsics = {
  prototype: createObject<string | symbol, unknown>(undefined),
  lengthKey: "length",
  calleeKey: "callee",
  iteratorKey: Symbol.iterator,
  values: Array.prototype.values,
  throwTypeError: () => {
    throw new TypeError();
  },
  indexKey: (index: number): string | symbol => String(index),
  numberValue: (value: number): unknown => value,
};
function setup(options: Partial<runtime.FunctionArgumentsPlan> = {}) {
  const plan: runtime.FunctionArgumentsPlan = {
    arrow: false,
    strict: false,
    simple: true,
    parameterExpressions: false,
    parameters: ["a"],
    functions: [],
    lexical: [],
    ...options,
  };
  const record = createDeclarativeEnvironment<unknown>(undefined);
  for (const name of new Set(plan.parameters))
    createMutableBinding(record, name, false);
  assert.equal(typeof runtime.instantiateFunctionArguments, "function");
  const callee = () => {};
  const object = runtime.instantiateFunctionArguments(
    record,
    [1],
    callee,
    plan,
    intrinsics,
    hooks,
    (object) => object,
  );
  return { object, record, callee };
}
test("arguments are created before parameters initialize and alias that environment", () => {
  const { object, record, callee } = setup();
  assert.ok(object);
  assert.equal(getBindingValue(record, "arguments").value, object);
  assert.equal(getBindingValue(record, "a").error, "reference");
  initializeBinding(record, "a", 42);
  assert.equal(getOwnProperty(object, "0")?.value, 42);
  assert.equal(getOwnProperty(object, "callee")?.value, callee);
  setProperty(object, "0", 7, { value: object, object }, hooks);
  assert.equal(getBindingValue(record, "a").value, 7);
  assert.equal(setMutableBinding(record, "arguments", 9, false), "none");
  assert.equal(getBindingValue(record, "arguments").value, 9);
});
test("strict and non-simple parameter lists are unmapped but only strict bindings are immutable", () => {
  for (const strict of [false, true]) {
    const { object, record } = setup({
      strict,
      simple: false,
      parameterExpressions: true,
    });
    assert.ok(object);
    initializeBinding(record, "a", 42);
    assert.equal(getOwnProperty(object, "0")?.value, 1);
    assert.equal(
      getOwnProperty(object, "callee")?.get,
      intrinsics.throwTypeError,
    );
    assert.equal(
      setMutableBinding(record, "arguments", 9, true),
      strict ? "type" : "none",
    );
  }
});
test("arrows and arguments parameters suppress creation regardless of body declarations", () => {
  for (const options of [{ arrow: true }, { parameters: ["arguments"] }]) {
    const { object, record } = setup(options);
    assert.equal(object, undefined);
    assert.equal(
      hasBinding(record, "arguments"),
      options.parameters !== undefined,
    );
  }
});
test("body functions and lexical arguments suppress creation only without parameter expressions", () => {
  for (const names of [
    { functions: ["arguments"] },
    { lexical: ["arguments"] },
  ]) {
    assert.equal(setup(names).object, undefined);
    const { object, record } = setup({
      ...names,
      simple: false,
      parameterExpressions: true,
    });
    assert.ok(object);
    assert.equal(getBindingValue(record, "arguments").value, object);
  }
});
