import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { nativeCallablePropertySource } from "./slice2b-view-fixtures.ts";

test("the typed function-valued property fixture agrees with Node", async () => {
  const source = ts.transpileModule(nativeCallablePropertySource, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const module = (await import(
    "data:text/javascript," + encodeURIComponent(source)
  )) as {
    run(): number;
  };
  assert.equal(module.run(), 42);
});
