import assert from "node:assert/strict";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";

const root = "packages/codegen/src/aarch64/";

test("AArch64 ISA entry does not load cells, scalar emission or IR", () => {
  const modules = workspaceModules([root + "isa.ts"]);
  assert.ok(
    modules.every(
      (module) =>
        module.id === root + "isa.ts" ||
        module.id.startsWith("packages/foundation/src/"),
    ),
  );
});

test("AArch64 cell entry loads only ISA and foundation", () => {
  const modules = workspaceModules([root + "cell.ts"]);
  assert.ok(
    modules.every(
      (module) =>
        module.id === root + "cell.ts" ||
        module.id === root + "isa.ts" ||
        module.id.startsWith("packages/foundation/src/"),
    ),
  );
});

test("scalar and barrier entries depend only on codegen, IR, ABI and foundation", () => {
  for (const entry of ["scalar/index.ts", "scalar/barrier.ts"]) {
    const modules = workspaceModules([root + entry]);
    assert.ok(
      modules.every((module) =>
        ["codegen", "ir", "abi", "foundation"].some((owner) =>
          module.id.startsWith("packages/" + owner + "/src/"),
        ),
      ),
    );
  }
});
