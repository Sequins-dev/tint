import assert from "node:assert/strict";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";

const root = "packages/ir/src/";

test("scalar IR entry stays independent of semantic handles and optimization", () => {
  const modules = workspaceModules([root + "scalar/index.ts"]);
  assert.ok(modules.some((module) => module.id === root + "scalar/index.ts"));
  assert.ok(
    modules.every(
      (module) =>
        module.id.startsWith(root + "scalar/") ||
        module.id.startsWith("packages/foundation/src/") ||
        // c-call prototypes: the dependency-free C model.
        module.id.startsWith("packages/abi/src/c/") ||
        // Typed-array element kinds: the dependency-free kind table the
        // collectors share.
        module.id === "packages/abi/src/typed-array.ts",
    ),
  );
});

test("semantic IR handles do not load scalar verification or optimization", () => {
  const modules = workspaceModules([root + "semantic/index.ts"]);
  assert.deepEqual(
    modules.map((module) => module.id),
    [root + "semantic/index.ts"],
  );
});

test("optimization and its direct tooling entries depend only on IR, foundation, the C model and the typed-array kinds", () => {
  for (const entry of ["index", "slots", "reference-lists"]) {
    const modules = workspaceModules([root + "optimization/" + entry + ".ts"]);
    assert.ok(
      modules.every(
        (module) =>
          module.id.startsWith(root) ||
          module.id.startsWith("packages/foundation/src/") ||
          module.id.startsWith("packages/abi/src/c/") ||
          module.id === "packages/abi/src/typed-array.ts",
      ),
    );
  }
});
