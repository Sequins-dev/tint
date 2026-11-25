// Node reference for tools/build-worker-typed-entry-fixture.ts: the same
// typed main and Worker entries exit 42 under Node.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("typed Worker entry fixture sources run under Node", () => {
  const directory = new URL("./worker-typed-entry/", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      // Workers inherit execArgv, so the script avoids --input-type.
      "-e",
      `import(${JSON.stringify(new URL("main.ts", directory).href)}).then(({ run }) => {
  process.exitCode = run(${JSON.stringify(fileURLToPath(new URL("peer.ts", directory)))}, ${JSON.stringify(fileURLToPath(new URL("thrower.ts", directory)))});
});`,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(result.status, 42, result.stderr + result.stdout);
  // Only the Worker's isolate evaluates the module only it imports.
  assert.equal(
    result.stdout.split("Worker-only module evaluated").length - 1,
    1,
    result.stdout,
  );
});
