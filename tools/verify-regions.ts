import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { nativeRegionFixture } from "./native-region-fixture.ts";
assert.equal(process.platform, "darwin", "requires macOS");
assert.equal(process.arch, "arm64", "requires native arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-regions-"));
try {
  for (const invalidRelease of [false, true]) {
    const image = buildAArch64Executable({
      ...nativeRegionFixture(invalidRelease),
      entryOffset: 0,
      identifier: "tint.verify.regions",
      minimumOS: { major: 26, minor: 6, patch: 2 },
      sdk: { major: 26, minor: 6, patch: 0 },
      maxByteLength: 1048576,
    });
    assert.equal(image.ok, true);
    const path = join(
      directory,
      invalidRelease ? "invalid-release" : "roundtrip",
    );
    writeFileSync(path, image.value.bytes, { mode: 0o755 });
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", path],
      { encoding: "utf8" },
    );
    assert.equal(signature.status, 0, signature.stderr);
    for (let i = 0; i < 8; i++) {
      const run = spawnSync(path, [], { timeout: 10000 });
      assert.equal(run.error, undefined);
      assert.equal(run.signal, null);
      assert.equal(run.status, 0, run.stderr.toString());
      assert.equal(
        run.stdout.length,
        16,
        "native region report must be present",
      );
      const page = run.stdout.readBigUInt64LE(0);
      assert.ok(page >= 4096n && (page & (page - 1n)) === 0n);
      assert.equal(run.stdout.readBigUInt64LE(8), 0x5a5an);
    }
  }
  console.log(
    "Verified signed native region fixtures: 16 executions, page-size discovery, zero-fill, boundary writes, mmap/munmap failures and release.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
