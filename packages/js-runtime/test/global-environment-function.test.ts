import { test } from "node:test";
import assert from "node:assert/strict";
import { createObject, type ObjectHooks } from "@tint/js-runtime/objects";
import {
  createDeclarativeEnvironment,
  createMutableBinding,
  initializeBinding,
  getBindingValue,
} from "@tint/js-runtime/environments/records";
import * as runtime from "../src/environments/global/index.ts";

function parameters() {
  assert.equal(typeof runtime.instantiateFunctionBody, "function");
  const object = createObject<string, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = runtime.createGlobalEnvironment(
    object,
    object,
    object,
    (name: string) => name,
    hooks,
  );
  const record = createDeclarativeEnvironment<unknown>(undefined);
  createMutableBinding(record, "a", false);
  initializeBinding(record, "a", 1);
  return runtime.createDeclarativeScope(
    runtime.createGlobalScope(global),
    record,
  );
}

test("function body instantiation copies parameters into separate var bindings", () => {
  const parameter = parameters();
  const captured = runtime.resolveBinding(parameter, "a", true);
  const body = runtime.instantiateFunctionBody(parameter, {
    separate: true,
    variables: ["a", "b", "a"],
    functions: [],
    lexical: [],
  });
  assert.notEqual(body, parameter);
  const local = runtime.resolveBinding(body, "a", true);
  assert.equal(runtime.getBindingReference(local).value, 1);
  assert.equal(runtime.putBindingReference(local, 42), "none");
  assert.equal(runtime.getBindingReference(captured).value, 1);
  assert.deepEqual(
    runtime.getBindingReference(runtime.resolveBinding(body, "b", true)),
    { error: "none", value: undefined },
  );
});

test("simple function bodies share parameter bindings and initialize lexical TDZ first", () => {
  const parameter = parameters();
  const observed: string[] = [];
  const body = runtime.instantiateFunctionBody(parameter, {
    separate: false,
    variables: ["a", "b"],
    lexical: [{ name: "x", constant: true }],
    functions: [
      {
        name: "f",
        instantiate: (scope) => {
          observed.push(
            runtime.getBindingReference(
              runtime.resolveBinding(scope, "x", true),
            ).error,
          );
          assert.equal(
            runtime.getBindingReference(
              runtime.resolveBinding(scope, "b", true),
            ).error,
            "none",
          );
          return 42;
        },
      },
    ],
  });
  assert.equal(body, parameter);
  assert.deepEqual(observed, ["reference"]);
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(body, "a", true)).value,
    1,
  );
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(body, "f", true)).value,
    42,
  );
});

test("last body function wins and suppresses same-name parameter copying", () => {
  const parameter = parameters();
  const order: string[] = [];
  const body = runtime.instantiateFunctionBody(parameter, {
    separate: true,
    variables: ["a"],
    lexical: [],
    functions: [
      {
        name: "a",
        instantiate: () => {
          throw new Error("superseded declaration");
        },
      },
      {
        name: "b",
        instantiate: () => {
          order.push("b");
          return 2;
        },
      },
      {
        name: "a",
        instantiate: (scope) => {
          order.push("a");
          assert.equal(
            runtime.getBindingReference(
              runtime.resolveBinding(scope, "a", true),
            ).value,
            undefined,
          );
          return 42;
        },
      },
    ],
  });
  assert.deepEqual(order, ["b", "a"]);
  assert.equal(getBindingValue(parameter.declarative!, "a").value, 1);
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(body, "a", true)).value,
    42,
  );
});
