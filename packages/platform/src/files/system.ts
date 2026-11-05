import type { FileHost } from "./service.ts";
import type { IOResult } from "../io/sync.ts";
export interface RawFileHost {
  readonly openRead: (path: Uint8Array) => number;
  readonly openExclusive: (path: Uint8Array, mode: number) => number;
  readonly read: (fd: number, buffer: Uint8Array) => number;
  readonly write: (fd: number, buffer: Uint8Array) => number;
  readonly close: (fd: number) => number;
  readonly chmod: (fd: number, mode: number) => number;
  readonly rename: (from: Uint8Array, to: Uint8Array) => number;
  readonly unlink: (path: Uint8Array) => number;
  readonly readlink: (path: Uint8Array, destination: Uint8Array) => number;
  readonly errorCode: (errno: number) => string;
}
export interface SynchronousFS {
  readonly openSync: (path: string, flags: "r" | "wx", mode?: number) => number;
  readonly readSync: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ) => number;
  readonly writeSync: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ) => number;
  readonly closeSync: (fd: number) => void;
  readonly fchmodSync: (fd: number, mode: number) => void;
  readonly renameSync: (from: string, to: string) => void;
  readonly unlinkSync: (path: string) => void;
  readonly readlinkSync: (path: string) => string;
}
export interface NativeFileSystem {
  readonly sync: SynchronousFS;
  readonly host: FileHost<number>;
}
export interface FileSystemError {
  readonly name: "Error";
  readonly code: string;
  readonly message: string;
  readonly syscall: string;
}
function pathBytes(path: string): Uint8Array | undefined {
  for (let index = 0; index < path.length; index++) {
    const unit = path.charCodeAt(index);
    if (unit === 0) return undefined;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = path.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
  }
  return new TextEncoder().encode(path + "\0");
}
function invalid<T>(): IOResult<T> {
  return {
    ok: false,
    error: { kind: "host", code: "EINVAL", interrupted: false },
  };
}
function unwrap<T>(result: IOResult<T>, syscall: string): T {
  if (result.ok) return result.value;
  const detail = result.error;
  const code = detail.kind === "host" ? detail.code : detail.kind;
  const error: FileSystemError = {
    name: "Error",
    code,
    message: syscall + ": " + code,
    syscall,
  };
  throw error;
}
/** Node-compatible call shapes and structured compiler I/O share one raw adapter.
 * Raw failures must already be -errno; no errno is read after managed allocation. */
export function createFileSystem(raw: RawFileHost): NativeFileSystem {
  let temporaryCounter = 0;
  function result(code: number): IOResult<number> {
    if (code >= 0) return { ok: true, value: code };
    const error = -code;
    const name = raw.errorCode(error);
    return {
      ok: false,
      error: { kind: "host", code: name, interrupted: name === "EINTR" },
    };
  }
  function status(code: number): IOResult<undefined> {
    const value = result(code);
    if (!value.ok) return value;
    return { ok: true, value: undefined };
  }
  function open(
    path: string,
    flags: "r" | "wx",
    mode: number,
  ): IOResult<number> {
    const bytes = pathBytes(path);
    if (
      bytes === undefined ||
      !Number.isInteger(mode) ||
      mode < 0 ||
      mode > 65535
    )
      return invalid<number>();
    return result(
      flags === "r" ? raw.openRead(bytes) : raw.openExclusive(bytes, mode),
    );
  }
  function rename(from: string, to: string): IOResult<undefined> {
    const a = pathBytes(from),
      b = pathBytes(to);
    if (a === undefined || b === undefined) return invalid<undefined>();
    return status(raw.rename(a, b));
  }
  function remove(path: string): IOResult<undefined> {
    const bytes = pathBytes(path);
    return bytes === undefined
      ? invalid<undefined>()
      : status(raw.unlink(bytes));
  }
  function readLink(path: string): IOResult<string> {
    const bytes = pathBytes(path);
    if (bytes === undefined) return invalid<string>();
    const maximum = 1048576;
    for (let capacity = 128; capacity <= maximum; capacity *= 2) {
      const buffer = new Uint8Array(capacity);
      const read = result(raw.readlink(bytes, buffer));
      if (!read.ok) return read;
      const length = read.value;
      if (!Number.isInteger(length) || length > capacity)
        return invalid<string>();
      if (length < capacity)
        return {
          ok: true,
          value: new TextDecoder().decode(buffer.subarray(0, length)),
        };
    }
    return {
      ok: false,
      error: { kind: "host", code: "ENAMETOOLONG", interrupted: false },
    };
  }
  function permissions(fd: number, mode: number): IOResult<undefined> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 65535)
      return invalid<undefined>();
    return status(raw.chmod(fd, mode));
  }
  function transfer(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    write: boolean,
  ): number {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > buffer.length ||
      length > buffer.length - offset
    )
      throw new RangeError("Invalid buffer range");
    const view = buffer.subarray(offset, offset + length);
    return unwrap<number>(
      result(write ? raw.write(fd, view) : raw.read(fd, view)),
      write ? "write" : "read",
    );
  }
  return {
    sync: {
      readlinkSync: (path) => unwrap<string>(readLink(path), "readlink"),
      openSync: (path, flags, mode: number = 0o666) =>
        unwrap<number>(open(path, flags, mode), "open"),
      readSync: (fd, buffer, offset, length, position) =>
        transfer(fd, buffer, offset, length, false),
      writeSync: (fd, buffer, offset, length, position) =>
        transfer(fd, buffer, offset, length, true),
      closeSync: (fd) => {
        unwrap<undefined>(status(raw.close(fd)), "close");
      },
      fchmodSync: (fd, mode) => {
        unwrap<undefined>(permissions(fd, mode), "fchmod");
      },
      renameSync: (from, to) => {
        unwrap<undefined>(rename(from, to), "rename");
      },
      unlinkSync: (path) => {
        unwrap<undefined>(remove(path), "unlink");
      },
    },
    host: {
      openRead: (path) => open(path, "r", 0),
      createTemporary: (destination) => {
        for (let attempt = 0; attempt < 16; attempt++) {
          const path = destination + ".tint-" + temporaryCounter;
          temporaryCounter =
            temporaryCounter < Number.MAX_SAFE_INTEGER
              ? temporaryCounter + 1
              : 0;
          const opened = open(path, "wx", 0o600);
          if (opened.ok)
            return { ok: true, value: { path, handle: opened.value } };
          const error = opened.error;
          if (error.kind !== "host" || error.code !== "EEXIST") return opened;
        }
        return {
          ok: false,
          error: { kind: "host", code: "EEXIST", interrupted: false },
        };
      },
      read: (fd, buffer) => result(raw.read(fd, buffer)),
      write: (fd, buffer) => result(raw.write(fd, buffer)),
      setPermissions: (fd, executable) =>
        permissions(fd, executable ? 0o755 : 0o644),
      close: (fd) => status(raw.close(fd)),
      replace: rename,
      remove,
    },
  };
}
