import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceModules } from "../../../tools/workspace-sources.ts";
test("shared DateTimeFormat contracts do not reach formatter bodies or CLDR date tables", () => {
  const modules = workspaceModules([
    "packages/js-runtime/src/objects/date-time-service-contracts.ts",
  ]);
  const implementations = modules.filter((source) =>
    /\/date-time-(format|parts|range|skeleton|locale|zone-name|calendar|zone-data|format-data|zone-format-data)\.ts$/.test(
      source.id,
    ),
  );
  assert.deepEqual(
    implementations.map((source) => source.id),
    [],
  );
});
