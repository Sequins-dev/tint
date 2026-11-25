// Node reference for tools/build-worker-typed-shared-fixture.ts: the same
// typed main and Worker entries exit 42 under Node.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("typed shared-memory Worker fixture sources run under Node", () => {
  const directory = new URL("./worker-typed-shared/", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      // Workers inherit execArgv, so the script avoids --input-type.
      "-e",
      `import(${JSON.stringify(new URL("main.ts", directory).href)}).then(({ run }) => {
  process.exitCode = run(${JSON.stringify(fileURLToPath(new URL("peer.ts", directory)))});
});`,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(result.status, 42, result.stderr + result.stdout);
});
