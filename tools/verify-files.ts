import { buildAArch64Executable } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { publishFile } from "@tint/platform/files/service";
import { createNodeFileHost } from "./node-file-host.ts";
import { nativeFileFixture } from "./native-file-fixture.ts";
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const directory = mkdtempSync(join(tmpdir(), "tint-native-files-"));
try {
  const built = buildAArch64Executable({
    ...nativeFileFixture(),
    entryOffset: 0,
    identifier: "tint.verify.files",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 1024 * 1024,
  });
  assert.equal(built.ok, true);
  const executable = join(directory, "copy");
  assert.deepEqual(
    publishFile(createNodeFileHost(), executable, built.value.bytes, true),
    { ok: true, value: undefined },
  );
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--strict", executable],
    { encoding: "utf8" },
  );
  assert.equal(signature.status, 0, signature.stderr);
  const creation = buildAArch64Executable({
    ...nativeFileFixture(false),
    entryOffset: 0,
    identifier: "tint.verify.creation",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 1024 * 1024,
  });
  assert.equal(creation.ok, true);
  const creationExe = join(directory, "creation");
  assert.deepEqual(
    publishFile(createNodeFileHost(), creationExe, creation.value.bytes, true),
    { ok: true, value: undefined },
  );
  const oldMask = process.umask(0o022);
  try {
    const input = join(directory, "mode-input"),
      temp = join(directory, "mode-temp"),
      output = join(directory, "mode-output");
    writeFileSync(input, "mode");
    const run = spawnSync(creationExe, [input, temp, output], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(readFileSync(output, "utf8"), "mode");
  } finally {
    process.umask(oldMask);
  }
  const source = join(directory, "source"),
    temporary = join(directory, "temporary"),
    output = join(directory, "output");
  function run(input: string, temp: string, dest: string, status: number) {
    const r = spawnSync(executable, [input, temp, dest], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.signal, null, r.stderr);
    assert.equal(r.status, status, r.stderr);
  }
  for (const length of [0, 1, 13, 4097]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 73) % 256);
    writeFileSync(source, bytes);
    writeFileSync(output, "old");
    run(source, temporary, output, 0);
    assert.deepEqual(new Uint8Array(readFileSync(output)), bytes);
    assert.equal(statSync(output).mode & 0o777, 0o755);
    assert.equal(existsSync(temporary), false);
  }
  writeFileSync(output, "preserve");
  run(join(directory, "missing"), temporary, output, 2);
  assert.equal(existsSync(temporary), false);
  assert.equal(readFileSync(output, "utf8"), "preserve");
  writeFileSync(temporary, "not ours");
  run(source, temporary, output, 17);
  assert.equal(readFileSync(temporary, "utf8"), "not ours");
  assert.equal(readFileSync(output, "utf8"), "preserve");
  rmSync(temporary);
  const targetDirectory = join(directory, "target-directory");
  mkdirSync(targetDirectory);
  run(source, temporary, targetDirectory, 21);
  assert.equal(existsSync(temporary), false);
  assert.equal(statSync(targetDirectory).isDirectory(), true);
  run(targetDirectory, temporary, output, 21);
  assert.equal(existsSync(temporary), false);
  assert.equal(readFileSync(output, "utf8"), "preserve");
  assert.deepEqual(new Uint8Array(readFileSync(executable)), built.value.bytes);
  console.log(
    "Native file ABI: 4 binary copies plus missing-input, exclusive-create, read-error and rename-error cases passed; temporary cleanup, errno, variadic open mode and executable permissions verified.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
