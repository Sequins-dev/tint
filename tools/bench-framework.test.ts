import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("benchmark measurement and native declaration adapter share one reusable framework", () => {
  assert.ok(existsSync("packages/bench/package.json"));
  for (const old of ["benchmark", "native-bench"])
    assert.equal(existsSync("packages/" + old), false);
  const manifest = JSON.parse(
    readFileSync("packages/bench/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports, {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./native": { types: "./dist/native.d.ts", import: "./dist/native.js" },
  });
  assert.ok(
    workspaceModules(["packages/bench/src/native.ts"]).every((m) =>
      m.id.startsWith("packages/bench/"),
    ),
  );
});
