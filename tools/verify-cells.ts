import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cellCases, nativeCellFixture } from "./native-cell-fixture.ts";
assert.equal(process.platform, "darwin", "requires macOS");
assert.equal(process.arch, "arm64", "requires arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-cells-"));
try {
  for (const test of cellCases) {
    const image = buildAArch64Executable({
      code: nativeCellFixture(test),
      entryOffset: 0,
      identifier: "tint.verify.cells",
      minimumOS: { major: 26, minor: 6, patch: 2 },
      sdk: { major: 26, minor: 6, patch: 0 },
      maxByteLength: 1048576,
    });
    assert.ok(image.ok);
    const path = join(directory, test.name);
    writeFileSync(path, image.value.bytes, { mode: 0o755 });
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", path],
      { encoding: "utf8" },
    );
    assert.equal(signature.status, 0, signature.stderr);
    for (let i = 0; i < 2; i++) {
      const debug = process.env.TINT_NATIVE_LLDB === "1";
      const captured = join(directory, "result.bin");
      const run = debug
        ? spawnSync(
            "lldb",
            [
              "--batch",
              "-o",
              `process launch -o ${captured}`,
              "-o",
              "process status",
              path,
            ],
            { timeout: 30000 },
          )
        : spawnSync(path, [], { timeout: 10000 });
      if (debug) assert.match(run.stdout.toString(), /exited with status = 0/);
      const stdout = debug ? readFileSync(captured) : run.stdout;
      assert.equal(run.error, undefined, test.name);
      assert.equal(run.signal, null, test.name);
      assert.equal(run.status, 0, test.name);
      assert.equal(stdout.length, 0);
    }
  }
  console.log(
    `Verified ${cellCases.length} internally signed cell-helper fixtures, each executed twice, with full payload/canary checks and inaccessible transfer pointers on failed guards.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
