import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createLoweredRealm } from "./lowered-node-host.ts";
import { classDecoratorCases } from "./class-decorator-cases.ts";

for (const [name, source] of classDecoratorCases)
  test(name, () => {
    // Pinned TypeScript emits standard-decorator helpers for a Node-only
    // semantic cross-check; this is not unchanged Test262 conformance evidence.
    const reference = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    });
    new vm.Script(reference.outputText).runInNewContext();
    assert.equal(createLoweredRealm().run(source), "none");
  });
