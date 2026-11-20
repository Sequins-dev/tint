import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Worker suite matches the Node host", () => {
  const url = new URL("./worker-threads-suite.mjs", import.meta.url);
  const result = spawnSync(
    process.env.TINT_NODE_WORKER_ORACLE ?? process.execPath,
    [
      "-e",
      "import(process.argv[1]).then(({run}) => run(process.argv[2])).then((status) => { process.exitCode = status; });",
      url.href,
      fileURLToPath(url),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 42, result.stderr);
});
