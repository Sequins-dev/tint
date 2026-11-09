import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  createDataProperty,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import * as runtime from "../src/environments/global/index.ts";
import { numberBinaryOperation } from "../src/objects/operators.ts";
import { numberPower } from "../src/objects/number-power.ts";

function setup() {
  const object = createObject<string, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const global = runtime.createGlobalEnvironment(
    object,
    object,
    object,
    (name: string) => name,
    hooks,
  );
  return { object, hooks, global, scope: runtime.createGlobalScope(global) };
}

test("a warm global identifier site reuses one immutable reference per write", () => {
  const { object, hooks, scope } = setup();
  createDataProperty(object, "x", 1, hooks);
  const cache = runtime.createGlobalIdentifierCache<string, unknown>();
  const cold = runtime.resolveBinding(scope, "x", false, cache);
  const warm = runtime.resolveBinding(scope, "x", false, cache);
  const again = runtime.resolveBinding(scope, "x", false, cache);
  assert.equal(cold.scope, scope);
  assert.equal(warm, again);
  assert.equal(runtime.putBindingReference(warm, 5), "none");
  assert.equal(runtime.getBindingReference(again).value, 5);
  // Deleting the property invalidates the cell; resolution is unresolvable
  // and allocates a fresh reference again.
  assert.equal(runtime.deleteBindingReference(warm), true);
  const missing = runtime.resolveBinding(scope, "x", true, cache);
  assert.equal(missing.scope, undefined);
  assert.notEqual(missing, warm);
  assert.equal(runtime.putBindingReference(missing, 1), "reference");
});

test("Number operators dispatch by spelling with JavaScript results", () => {
  const values = [
    0,
    -0,
    1,
    -1,
    2.5,
    -7,
    31,
    33,
    NaN,
    Infinity,
    -Infinity,
    2 ** 31,
  ];
  const operators: [string, (a: number, b: number) => number | boolean][] = [
    ["+", (a, b) => a + b],
    ["-", (a, b) => a - b],
    ["*", (a, b) => a * b],
    ["/", (a, b) => a / b],
    ["%", (a, b) => a % b],
    // Exponentiation keeps the runtime's own correctly rounded numberPower.
    ["**", numberPower],
    ["<", (a, b) => a < b],
    [">", (a, b) => a > b],
    ["<=", (a, b) => a <= b],
    [">=", (a, b) => a >= b],
    ["&", (a, b) => a & b],
    ["|", (a, b) => a | b],
    ["^", (a, b) => a ^ b],
    ["<<", (a, b) => a << b],
    [">>", (a, b) => a >> b],
    [">>>", (a, b) => a >>> b],
  ];
  for (const [operator, reference] of operators)
    for (const a of values)
      for (const b of values)
        assert.ok(
          Object.is(numberBinaryOperation(operator, a, b), reference(a, b)),
          `${a} ${operator} ${b}`,
        );
  assert.throws(() => numberBinaryOperation("==", 1, 1));
});
