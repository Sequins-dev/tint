// Development adapter: Node stays outside the portable package graph.
import {
  openSync,
  readSync,
  writeSync,
  fchmodSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import type { FileHost } from "@tint/platform/files/service";
import type { IOResult } from "@tint/platform/io/sync";
let temporaryCounter = 0;

function attempt<T>(operation: () => T): IOResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      typeof error.code !== "string"
    )
      throw error;
    return {
      ok: false,
      error: {
        kind: "host",
        code: error.code,
        interrupted: error.code === "EINTR",
      },
    };
  }
}
export function createNodeFileHost(): FileHost<number> {
  return {
    openRead: (path) => attempt(() => openSync(path, "r")),
    createTemporary(destination) {
      for (let i = 0; i < 16; i++) {
        const path = destination + ".tint-" + temporaryCounter;
        temporaryCounter =
          temporaryCounter < Number.MAX_SAFE_INTEGER ? temporaryCounter + 1 : 0;
        const opened = attempt(() => openSync(path, "wx", 0o600));
        if (opened.ok)
          return { ok: true, value: { path, handle: opened.value } };
        if (opened.error.kind !== "host" || opened.error.code !== "EEXIST")
          return opened;
      }
      return {
        ok: false,
        error: { kind: "host", code: "EEXIST", interrupted: false },
      };
    },
    read: (fd, buffer) =>
      attempt(() => readSync(fd, buffer, 0, buffer.length, null)),
    write: (fd, buffer) =>
      attempt(() => writeSync(fd, buffer, 0, buffer.length, null)),
    setPermissions: (fd, executable) =>
      attempt(() => {
        fchmodSync(fd, executable ? 0o755 : 0o644);
        return undefined;
      }),
    close: (fd) =>
      attempt(() => {
        closeSync(fd);
        return undefined;
      }),
    replace: (from, to) =>
      attempt(() => {
        renameSync(from, to);
        return undefined;
      }),
    remove: (path) =>
      attempt(() => {
        unlinkSync(path);
        return undefined;
      }),
  };
}
