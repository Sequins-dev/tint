import assert from "node:assert/strict";
import test from "node:test";
import { cpuPause } from "@tint/native-runtime/intrinsics/spin-hint";
import { projectBuildRequest, projectRoots } from "@tint/compiler/project";
import { workspaceModules } from "./workspace-sources.ts";
test("cpu pause has no Node fallback or automatic host grants", () => {
  assert.throws(
    () => cpuPause(),
    (error) => error === "HOST_UNAVAILABLE",
  );
  const modules = workspaceModules(projectRoots());
  assert.ok(
    !modules.some(
      (module) =>
        module.id === "packages/native-runtime/src/intrinsics/spin-hint.ts",
    ),
  );
  const request = projectBuildRequest(modules, () => {});
  assert.ok(
    !request.hostBindings.some((binding) => binding.operation === "cpu-pause"),
  );
});
