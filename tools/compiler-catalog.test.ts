import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFiles, projectMappings } from "@tint/compiler/cli";
import { workspaceSources } from "./workspace-sources.ts";

test("native bootstrap catalog includes every workspace source and import grant", () => {
  const workspace = workspaceSources();
  assert.deepEqual(
    projectFiles(),
    workspace.inputs.map(({ id, packageId }) => ({ id, packageId })),
    "regenerate the catalog with tools/generate-compiler-catalog.ts",
  );
  const grants = (items: typeof workspace.mappings) =>
    items.map((item) => JSON.stringify(item)).sort();
  assert.deepEqual(grants(projectMappings()), grants(workspace.mappings));
});
