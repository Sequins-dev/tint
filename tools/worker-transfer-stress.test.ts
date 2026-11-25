import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("the Worker transfer stress passes on the Node host", () => {
  const url = new URL("./worker-transfer-stress.mjs", import.meta.url);
  const result = spawnSync(
    process.env.TINT_NODE_WORKER_ORACLE ?? process.execPath,
    [
      "-e",
      "import(process.argv[1]).then(({run}) => run(process.argv[2])).then((status) => { process.exitCode = status; });",
      url.href,
      fileURLToPath(url),
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 42, result.stderr);
  assert.match(result.stdout, /transferred buffers retained and re-verified/);
});

test("the typed Worker zlib stress sources run under Node", () => {
  const directory = new URL("./worker-zlib-stress/", import.meta.url);
  const result = spawnSync(
    process.env.TINT_NODE_WORKER_ORACLE ?? process.execPath,
    [
      // Workers inherit execArgv, so the script avoids --input-type.
      "-e",
      `import(${JSON.stringify(new URL("main.ts", directory).href)}).then(({ run }) => {
  process.exitCode = run(${JSON.stringify(fileURLToPath(new URL("peer.ts", directory)))});
});`,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 42, result.stderr + result.stdout);
  assert.match(
    result.stdout,
    /zlib outputs per isolate retained and re-verified/,
  );
});
