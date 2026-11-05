import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, publishFile } from "@tint/platform/files/service";
import { createNodeFileHost } from "./node-file-host.ts";
test("Node file host round-trips bytes and applies explicit permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-files-"));
  try {
    const host = createNodeFileHost(),
      path = join(directory, "artifact"),
      bytes = Uint8Array.from({ length: 70001 }, (_, i) => i % 256);
    writeFileSync(path, "old");
    assert.deepEqual(publishFile(host, path, bytes, true), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(new Uint8Array(readFileSync(path)), bytes);
    assert.deepEqual(readFile(host, path, bytes.length), {
      ok: true,
      value: bytes,
    });
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o777, 0o755);
    assert.equal(readFile(host, path, bytes.length - 1).ok, false);
    assert.equal(publishFile(host, path, new Uint8Array(), false).ok, true);
    assert.deepEqual(readFile(host, path, 0), {
      ok: true,
      value: new Uint8Array(),
    });
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o777, 0o644);
    assert.deepEqual(readdirSync(directory), ["artifact"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("real destination survives failed writing and failed replacement, with no temporary leftovers", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-files-"));
  try {
    const host = createNodeFileHost(),
      path = join(directory, "output");
    writeFileSync(path, "original");
    const failing = {
      ...host,
      write: () => ({
        ok: false as const,
        error: { kind: "host" as const, code: "ENOSPC", interrupted: false },
      }),
    };
    const result = publishFile(failing, path, new Uint8Array([1]), false);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path, "utf8"), "original");
    const destination = join(directory, "directory");
    mkdirSync(destination);
    assert.equal(
      publishFile(host, destination, new Uint8Array([1]), false).ok,
      false,
    );
    assert.deepEqual(readdirSync(directory).sort(), ["directory", "output"]);
    const missing = readFile(host, join(directory, "missing"), 100);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.operation, "open");
      assert.deepEqual(missing.cleanup, []);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("temporary names need no entropy and exclusive creation preserves collisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-temp-collision-"));
  try {
    const destination = join(directory, "output");
    const firstHost = createNodeFileHost();
    const first = firstHost.createTemporary(destination);
    assert.ok(first.ok, JSON.stringify(first));
    assert.ok(firstHost.close(first.value.handle).ok);
    const suffix = /\.tint-(\d+)$/.exec(first.value.path);
    assert.ok(suffix, "temporary names use the bounded counter policy");
    const collision = destination + ".tint-" + (Number(suffix[1]) + 1);
    writeFileSync(collision, "preserve", { flag: "wx" });
    const secondHost = createNodeFileHost();
    const second = secondHost.createTemporary(destination);
    assert.ok(second.ok, JSON.stringify(second));
    assert.notEqual(second.value.path, first.value.path);
    assert.notEqual(second.value.path, collision);
    assert.ok(secondHost.close(second.value.handle).ok);
    assert.equal(readFileSync(collision, "utf8"), "preserve");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
