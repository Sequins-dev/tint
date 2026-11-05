import assert from "node:assert/strict";
import test from "node:test";
import * as modules from "../src/modules/index.ts";

test("module and Script record views require compiler-issued bindings", () => {
  assert.equal(typeof modules.viewModuleRecord, "function");
  assert.equal(typeof modules.viewScriptRecord, "function");
  for (const value of [
    undefined,
    42,
    {},
    { kind: "script" },
    { kind: "module" },
  ]) {
    assert.throws(
      () => modules.viewModuleRecord(value),
      (error) => error === "UNBOUND_MODULE_RECORD_VIEW",
    );
    assert.throws(
      () => modules.viewScriptRecord(value),
      (error) => error === "UNBOUND_SCRIPT_RECORD_VIEW",
    );
  }
});
