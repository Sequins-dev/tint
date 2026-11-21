import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolve } from "node:path";

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

test(
  "the Node-hosted Tint image runs the shared suite on real Node Workers",
  { skip: process.env.TINT_NODE_HOSTED_IMAGE === undefined },
  () => {
    const image = resolve(process.env.TINT_NODE_HOSTED_IMAGE!);
    const runner = fileURLToPath(
      new URL("./node-hosted-image.mjs", import.meta.url),
    );
    const node = process.env.TINT_NODE_WORKER_ORACLE ?? process.execPath;
    const result = spawnSync(
      "lldb",
      [
        "--no-lldbinit",
        "--batch",
        "-o",
        "settings set target.disable-aslr false",
        "-o",
        "process launch --stop-at-entry",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateStopped",
        "-o",
        "continue",
        "-o",
        'script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42; print("INFERIOR_EXIT", 42)',
        "--",
        node,
        "--experimental-ffi",
        runner,
        image,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /^INFERIOR_EXIT 42$/m);
  },
);
