import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  publishFile,
  type FileHost,
} from "@tint/platform/files/service";
// Stateful fake filesystem, with partial transfers and failures at named operations.
function filesystem(fail: readonly string[] = []) {
  const events: string[] = [],
    files = new Map([
      ["source", new Uint8Array([1, 2, 3])],
      ["output", new Uint8Array([9])],
    ]);
  let next = 1;
  const open = new Map<number, { path: string; offset: number }>();
  const error = (code: string) => ({
    ok: false as const,
    error: { kind: "host" as const, code, interrupted: code === "EINTR" },
  });
  const success = <T>(value: T) => ({ ok: true as const, value });
  const host: FileHost<number> = {
    openRead(path) {
      events.push("open");
      if (fail.includes("open")) return error("open");
      const fd = next++;
      open.set(fd, { path, offset: 0 });
      return success(fd);
    },
    createTemporary() {
      events.push("create");
      if (fail.includes("create")) return error("create");
      files.set("temp", new Uint8Array());
      const fd = next++;
      open.set(fd, { path: "temp", offset: 0 });
      return success({ path: "temp", handle: fd });
    },
    read(fd, b) {
      events.push("read");
      if (fail.includes("read")) return error("read");
      const file = open.get(fd)!;
      const bytes = files.get(file.path)!;
      const n = Math.min(2, b.length, bytes.length - file.offset);
      b.set(bytes.subarray(file.offset, file.offset + n));
      file.offset += n;
      return success(n);
    },
    write(fd, b) {
      events.push("write");
      if (fail.includes("write")) return error("write");
      const file = open.get(fd)!,
        old = files.get(file.path)!;
      const n = Math.min(2, b.length),
        bytes = new Uint8Array(old.length + n);
      bytes.set(old);
      bytes.set(b.subarray(0, n), old.length);
      files.set(file.path, bytes);
      return success(n);
    },
    setPermissions() {
      events.push("permissions");
      return fail.includes("permissions")
        ? error("permissions")
        : success(undefined);
    },
    close(fd) {
      events.push("close");
      open.delete(fd);
      return fail.includes("close") ? error("EINTR") : success(undefined);
    },
    replace(from, to) {
      events.push("replace");
      if (fail.includes("replace")) return error("replace");
      files.set(to, files.get(from)!);
      files.delete(from);
      return success(undefined);
    },
    remove(path) {
      events.push("remove");
      if (fail.includes("remove")) return error("remove");
      files.delete(path);
      return success(undefined);
    },
  };
  return { host, events, files, open };
}
test("readFile owns its handle through short reads, errors, limits and close failures", () => {
  const f = filesystem();
  assert.deepEqual(readFile(f.host, "source", 3), {
    ok: true,
    value: new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(f.events, ["open", "read", "read", "read", "close"]);
  assert.equal(f.open.size, 0);
  for (const failures of [["read"], ["close"], ["read", "close"], ["open"]]) {
    const f = filesystem(failures),
      r = readFile(f.host, "source", 3);
    assert.equal(r.ok, false);
    assert.equal(f.open.size, 0);
    assert.equal(
      f.events.filter((x) => x === "close").length,
      failures.includes("open") ? 0 : 1,
    );
    if (!r.ok) {
      assert.equal(
        r.error.operation,
        failures.includes("open")
          ? "open"
          : failures.includes("read")
            ? "read"
            : "close",
      );
      assert.equal(r.cleanup.length, failures.length === 2 ? 1 : 0);
    }
  }
  const limited = filesystem();
  assert.equal(readFile(limited.host, "source", 2).ok, false);
  assert.equal(limited.open.size, 0);
  const invalid = filesystem();
  assert.equal(readFile(invalid.host, "source", NaN).ok, false);
  assert.deepEqual(invalid.events, []);
});
test("publication orders write, permissions, close and replace; original survives every failure", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]),
    f = filesystem();
  assert.deepEqual(publishFile(f.host, "output", bytes, true), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(f.events, [
    "create",
    "write",
    "write",
    "write",
    "permissions",
    "close",
    "replace",
  ]);
  assert.deepEqual(f.files.get("output"), bytes);
  assert.equal(f.files.has("temp"), false);
  assert.equal(f.open.size, 0);
  for (const operation of [
    "create",
    "write",
    "permissions",
    "close",
    "replace",
  ]) {
    const f = filesystem([operation]),
      r = publishFile(f.host, "output", bytes, false);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.operation, operation);
    assert.deepEqual(f.files.get("output"), new Uint8Array([9]));
    assert.equal(f.files.has("temp"), false);
    assert.equal(f.open.size, 0);
    assert.equal(
      f.events.filter((x) => x === "close").length,
      operation === "create" ? 0 : 1,
    );
  }
});
test("cleanup errors do not hide the primary failure or cause close retries", () => {
  const f = filesystem(["write", "close", "remove"]),
    r = publishFile(f.host, "output", new Uint8Array([1]), false);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.operation, "write");
    assert.equal(r.temporaryPath, "temp");
    assert.deepEqual(
      r.cleanup.map((x) => x.operation),
      ["close", "remove"],
    );
  }
  assert.deepEqual(f.events, ["create", "write", "close", "remove"]);
  assert.equal(f.files.has("temp"), true);
  assert.deepEqual(f.files.get("output"), new Uint8Array([9]));
});
test("exception paths still attempt close and temporary cleanup", () => {
  const f = filesystem();
  const readHost = {
    ...f.host,
    read: () => {
      throw Error("unexpected");
    },
  };
  assert.throws(() => readFile(readHost, "source", 10), /unexpected/);
  assert.equal(f.open.size, 0);
  const g = filesystem();
  const writeHost = {
    ...g.host,
    write: () => {
      throw Error("unexpected");
    },
  };
  assert.throws(
    () => publishFile(writeHost, "output", new Uint8Array([1]), false),
    /unexpected/,
  );
  assert.equal(g.open.size, 0);
  assert.equal(g.files.has("temp"), false);
});
