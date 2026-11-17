import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileSystem, type RawFileHost } from "../src/files/system.ts";
import { darwinErrorCode } from "../src/darwin/fs-errors.ts";
function fixture() {
  const paths: string[] = [],
    modes: number[] = [],
    writes: Uint8Array[] = [];
  let failure = 0;
  let link = "target";
  const path = (bytes: Uint8Array) => {
    assert.equal(bytes.at(-1), 0);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, -1),
    );
    paths.push(text);
    return text;
  };
  const raw: RawFileHost = {
    openRead: (bytes) => {
      path(bytes);
      return failure || 3;
    },
    openExclusive: (bytes, mode) => {
      path(bytes);
      modes.push(mode);
      return failure || 4;
    },
    read: (_fd, buffer) => {
      if (failure) return failure;
      buffer.set([1, 255].slice(0, buffer.length));
      return Math.min(2, buffer.length);
    },
    write: (_fd, buffer) => {
      writes.push(buffer.slice());
      return failure || buffer.length;
    },
    close: () => failure,
    chmod: (_fd, mode) => {
      modes.push(mode);
      return failure;
    },
    rename: (a, b) => {
      path(a);
      path(b);
      return failure;
    },
    unlink: (a) => {
      path(a);
      return failure;
    },
    readlink: (a, buffer) => {
      path(a);
      if (failure) return failure;
      const bytes = new TextEncoder().encode(link);
      buffer.set(bytes.subarray(0, buffer.length));
      return Math.min(bytes.length, buffer.length);
    },
    errorCode: darwinErrorCode,
  };
  return {
    system: createFileSystem(raw),
    paths,
    modes,
    writes,
    link: (value: string) => {
      link = value;
    },
    fail: (n: number) => {
      failure = n;
    },
  };
}
test("finite fs adapter preserves UTF-8 paths, selected views and modes", () => {
  const f = fixture(),
    fs = f.system.sync;
  assert.equal(fs.openSync("😀.ts", "wx", 0o600), 4);
  assert.deepEqual(f.paths, ["😀.ts"]);
  assert.deepEqual(f.modes, [0o600]);
  const bytes = new Uint8Array(5).fill(9);
  assert.equal(fs.readSync(3, bytes, 1, 2, null), 2);
  assert.deepEqual([...bytes], [9, 1, 255, 9, 9]);
  assert.equal(fs.writeSync(3, bytes, 1, 2, null), 2);
  assert.deepEqual([...f.writes[0]!], [1, 255]);
  assert.throws(() => fs.readSync(3, bytes, 4, 2, null), RangeError);
  fs.fchmodSync(3, 0o755);
  fs.closeSync(3);
  fs.renameSync("a", "b");
  fs.unlinkSync("b");
  assert.deepEqual(f.modes, [0o600, 0o755]);
});
test("host errors retain code and interruption; invalid paths never reach the raw host", () => {
  const f = fixture();
  f.fail(-4);
  const result = f.system.host.read(3, new Uint8Array(1));
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(result.error, {
      kind: "host",
      code: "EINTR",
      interrupted: true,
    });
  assert.throws(
    () => f.system.sync.closeSync(3),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EINTR",
  );
  for (const path of ["a\0b", "\ud800", "\udc00"]) {
    const result = f.system.host.openRead(path);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(f.paths, []);
});
test("temporary creation is bounded and uses private modes", () => {
  const f = fixture();
  const a = f.system.host.createTemporary("out"),
    b = f.system.host.createTemporary("out");
  assert.ok(a.ok && b.ok);
  assert.equal(a.value.path, "out.tint-0");
  assert.equal(b.value.path, "out.tint-1");
  f.fail(-17);
  assert.equal(f.system.host.createTemporary("out").ok, false);
  assert.equal(f.paths.length, 18);
  assert.ok(f.modes.every((m) => m === 0o600));
});

test("readlink grows past truncation and decodes target bytes without following them", () => {
  const f = fixture();
  const target = "../" + "x".repeat(254) + "/😀.ts";
  f.link(target);
  assert.equal(f.system.sync.readlinkSync("alias"), target);
  assert.ok(f.paths.length > 1);
  f.paths.length = 0;
  assert.throws(() => f.system.sync.readlinkSync("invalid\0path"));
  assert.deepEqual(f.paths, []);
  f.fail(-2);
  assert.throws(
    () => f.system.sync.readlinkSync("missing"),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT" &&
      "syscall" in error &&
      error.syscall === "readlink",
  );
});
test("Linux and Darwin errno names agree below 35 and differ above", async () => {
  const { linuxErrorCode } = await import("../src/linux/fs-errors.ts");
  for (let errno = 1; errno <= 34; errno++)
    assert.equal(linuxErrorCode(errno), darwinErrorCode(errno));
  assert.equal(linuxErrorCode(36), "ENAMETOOLONG");
  assert.equal(linuxErrorCode(39), "ENOTEMPTY");
  assert.equal(linuxErrorCode(40), "ELOOP");
  assert.equal(darwinErrorCode(62), "ELOOP");
  assert.equal(linuxErrorCode(62), "ERRNO_62");
});
