import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceModules } from "./workspace-sources.ts";
import { projectBuildRequest } from "@tint/compiler/cli";
import { bindModule } from "@tint/typescript/binding";
import { compileArm64Program } from "@tint/compiler/native";

test("native relation query entry keeps recursive solver state off its fast-path frame", () => {
  const entry = "packages/typescript/src/types/index.ts",
    runtimes = projectBuildRequest([], () => {}).runtimes;
  const modules = workspaceModules([entry, ...runtimes.map((r) => r.module)]);
  const source = modules.find((m) => m.id === entry);
  assert.ok(source);
  const bound = bindModule(source.module, [
    "undefined",
    "Number",
    "Math",
    "Map",
    "Set",
    "Uint8Array",
    "Uint32Array",
    "Float64Array",
  ]);
  assert.ok(bound.ok, JSON.stringify(bound));
  const binding = bound.value.bindings.find(
    (b) => b.kind === "function" && b.name === "assignable",
  );
  assert.ok(binding);
  const compiled = compileArm64Program({
    modules,
    entry,
    exports: ["createTypeSystem"],
    runtimes,
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  // The compiler's virtual root is module zero; the requested entry is first.
  const query = compiled.value.native.functions.find((f) =>
    f.name.startsWith(`@1:value:${binding.id}$`),
  );
  assert.ok(query);
  assert.ok(
    query.frameBytes <= 8192,
    `relation query frame: ${query.frameBytes} bytes`,
  );
});
