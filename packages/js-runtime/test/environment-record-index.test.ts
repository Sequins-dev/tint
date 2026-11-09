import { test } from "node:test";
import assert from "node:assert/strict";
import * as env from "../src/environments/records/index.ts";
test("declarative bindings distinguish TDZ from an initialized undefined value", () => {
  assert.equal(typeof env.createDeclarativeEnvironment, "function");
  const record = env.createDeclarativeEnvironment<unknown>(undefined);
  assert.equal(env.hasBinding(record, "x"), false);
  env.createMutableBinding(record, "x", false);
  assert.equal(env.hasBinding(record, "x"), true);
  assert.equal(env.getBindingValue(record, "x").error, "reference");
  assert.equal(env.setMutableBinding(record, "x", 1, false), "reference");
  env.initializeBinding(record, "x", undefined);
  assert.deepEqual(env.getBindingValue(record, "x"), {
    error: "none",
    value: undefined,
  });
  assert.equal(env.setMutableBinding(record, "x", 42, true), "none");
  assert.equal(env.getBindingValue(record, "x").value, 42);
  assert.equal(env.deleteBinding(record, "x"), false);
});
test("immutable binding strictness controls assignment errors", () => {
  for (const bindingStrict of [false, true])
    for (const assignmentStrict of [false, true]) {
      const record = env.createDeclarativeEnvironment(0);
      env.createImmutableBinding(record, "x", bindingStrict);
      assert.equal(
        env.setMutableBinding(record, "x", 3, assignmentStrict),
        "reference",
      );
      env.initializeBinding(record, "x", 1);
      assert.equal(
        env.setMutableBinding(record, "x", 2, assignmentStrict),
        bindingStrict || assignmentStrict ? "type" : "none",
      );
      assert.equal(env.getBindingValue(record, "x").value, 1);
      assert.equal(env.deleteBinding(record, "x"), false);
    }
});
test("missing strict assignments fail while non-strict assignments create deletable bindings", () => {
  const record = env.createDeclarativeEnvironment(0);
  assert.equal(env.setMutableBinding(record, "x", 1, true), "reference");
  assert.equal(env.hasBinding(record, "x"), false);
  assert.equal(env.setMutableBinding(record, "x", 2, false), "none");
  assert.deepEqual(env.getBindingValue(record, "x"), {
    error: "none",
    value: 2,
  });
  assert.equal(env.deleteBinding(record, "x"), true);
  assert.equal(env.hasBinding(record, "x"), false);
  assert.equal(env.deleteBinding(record, "x"), true);
});
test("declaration and initialization enforce internal lifecycle invariants", () => {
  const record = env.createDeclarativeEnvironment(0);
  env.createMutableBinding(record, "x", true);
  assert.throws(() => env.createMutableBinding(record, "x", false));
  assert.throws(() => env.createImmutableBinding(record, "x", true));
  assert.throws(() => env.initializeBinding(record, "missing", 1));
  env.initializeBinding(record, "x", 1);
  assert.throws(() => env.initializeBinding(record, "x", 2));
  assert.equal(env.deleteBinding(record, "x"), true);
});

test("function this bindings distinguish uninitialized from initialized undefined", () => {
  assert.equal(typeof env.createThisBinding, "function");
  const binding = env.createThisBinding<unknown>(undefined);
  assert.equal(env.getThisBinding(binding).error, "reference");
  assert.equal(env.bindThisValue(binding, undefined), "none");
  assert.deepEqual(env.getThisBinding(binding), {
    error: "none",
    value: undefined,
  });
});

test("function this bindings reject rebinding without replacing the original receiver", () => {
  assert.equal(typeof env.createThisBinding, "function");
  const first = { x: 42 },
    second = { x: 1 };
  const binding = env.createThisBinding<unknown>(undefined);
  const readFromArrow = () => env.getThisBinding(binding);
  assert.equal(readFromArrow().error, "reference");
  assert.equal(env.bindThisValue(binding, first), "none");
  assert.equal(readFromArrow().value, first);
  assert.equal(env.bindThisValue(binding, second), "reference");
  assert.equal(readFromArrow().value, first);
  const other = env.createThisBinding<unknown>(undefined);
  assert.equal(env.getThisBinding(other).error, "reference");
});

test("import bindings share live target values and target TDZ", () => {
  assert.equal(typeof env.createImportBinding, "function");
  const source = env.createDeclarativeEnvironment<unknown>(undefined),
    target = env.createDeclarativeEnvironment<unknown>(undefined);
  env.createMutableBinding(source, "value", false);
  env.createImportBinding(target, "alias", source, "value");
  assert.equal(env.hasBinding(target, "alias"), true);
  assert.equal(env.getBindingValue(target, "alias").error, "reference");
  env.initializeBinding(source, "value", 19);
  assert.equal(env.getBindingValue(target, "alias").value, 19);
  env.setMutableBinding(source, "value", 42, true);
  assert.equal(env.getBindingValue(target, "alias").value, 42);
});
test("import assignment rejects before target TDZ and never mutates its exporter", () => {
  const source = env.createDeclarativeEnvironment<unknown>(undefined),
    target = env.createDeclarativeEnvironment<unknown>(undefined);
  env.createMutableBinding(source, "value", false);
  env.createImportBinding(target, "alias", source, "value");
  for (const strict of [false, true])
    assert.equal(env.setMutableBinding(target, "alias", 7, strict), "type");
  assert.equal(env.getBindingValue(source, "value").error, "reference");
  env.initializeBinding(source, "value", 42);
  for (const strict of [false, true])
    assert.equal(env.setMutableBinding(target, "alias", 7, strict), "type");
  assert.equal(env.getBindingValue(source, "value").value, 42);
});
test("an imported binding cannot be initialized or deleted through its importer", () => {
  const source = env.createDeclarativeEnvironment<unknown>(undefined),
    target = env.createDeclarativeEnvironment<unknown>(undefined);
  env.createMutableBinding(source, "value", true);
  env.createImportBinding(target, "alias", source, "value");
  assert.throws(
    () => env.initializeBinding(target, "alias", 7),
    (e) => e === "INITIALIZE_BINDING_INVARIANT",
  );
  assert.equal(env.deleteBinding(target, "alias"), false);
  assert.equal(env.hasBinding(target, "alias"), true);
  env.initializeBinding(source, "value", 42);
  assert.equal(env.getBindingValue(target, "alias").value, 42);
});
test("import aliases remain live across another importing environment", () => {
  const source = env.createDeclarativeEnvironment<unknown>(undefined),
    a = env.createDeclarativeEnvironment<unknown>(undefined),
    b = env.createDeclarativeEnvironment<unknown>(undefined);
  env.createImmutableBinding(source, "value", true);
  env.createImportBinding(a, "a", source, "value");
  env.createImportBinding(b, "b", a, "a");
  env.initializeBinding(source, "value", 42);
  assert.equal(env.getBindingValue(b, "b").value, 42);
  assert.equal(env.setMutableBinding(b, "b", 0, true), "type");
  assert.throws(
    () => env.createImportBinding(b, "b", source, "value"),
    (e) => e === "DUPLICATE_BINDING_INVARIANT",
  );
  assert.throws(
    () => env.createImportBinding(b, "missing", source, "absent"),
    (e) => e === "IMPORT_BINDING_INVARIANT",
  );
  assert.equal(env.hasBinding(b, "missing"), false);
});
test("small environments keep bindings inline and spill extra names to an overflow map", () => {
  const record = env.createDeclarativeEnvironment<unknown>(undefined);
  const names = ["a", "b", "c", "d", "e", "f"];
  for (const name of names) env.createMutableBinding(record, name, true);
  names.forEach((name, index) => env.initializeBinding(record, name, index));
  // The first four live inline; no map exists until a fifth name arrives.
  assert.equal(record.name0, "a");
  assert.equal(record.name3, "d");
  assert.equal(record.overflow?.size, 2);
  names.forEach((name, index) => {
    assert.equal(env.hasBinding(record, name), true);
    assert.equal(env.findBinding(record, name)?.value, index);
    assert.equal(env.getBindingValue(record, name).value, index);
  });
  assert.throws(() => env.createMutableBinding(record, "c", true));
  assert.throws(() => env.createMutableBinding(record, "f", true));
  // Deletion leaves a hole the next binding reuses.
  assert.equal(env.deleteBinding(record, "b"), true);
  assert.equal(env.deleteBinding(record, "e"), true);
  assert.equal(env.hasBinding(record, "b"), false);
  assert.equal(env.findBinding(record, "e"), undefined);
  env.createMutableBinding(record, "g", false);
  assert.equal(record.name1, "g");
  assert.equal(env.getBindingValue(record, "g").error, "reference");
  const fresh = env.createDeclarativeEnvironment<unknown>(undefined);
  env.createMutableBinding(fresh, "only", false);
  assert.equal(fresh.overflow, undefined);
});
