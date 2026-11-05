import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { workspaceModules } from "./workspace-sources.ts";
test("AArch64 startup emission belongs to target code generation", () => {
  assert.equal(existsSync("packages/aarch64-host"), false);
  const manifest = JSON.parse(
    readFileSync("packages/codegen/package.json", "utf8"),
  );
  assert.deepEqual(manifest.exports["./aarch64/startup"], {
    types: "./dist/aarch64/startup.d.ts",
    import: "./dist/aarch64/startup.js",
  });
  assert.ok(
    workspaceModules(["packages/codegen/src/aarch64/startup.ts"]).every((m) =>
      /^packages\/(codegen|abi|ir|foundation)\//.test(m.id),
    ),
  );
});
