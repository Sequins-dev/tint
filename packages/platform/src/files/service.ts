import { readAll, writeAll, type IOResult, type IOError } from "../io/sync.ts";
export interface FileHost<H> {
  readonly openRead: (path: string) => IOResult<H>;
  readonly createTemporary: (
    destination: string,
  ) => IOResult<{ readonly path: string; readonly handle: H }>;
  readonly read: (handle: H, destination: Uint8Array) => IOResult<number>;
  readonly write: (handle: H, source: Uint8Array) => IOResult<number>;
  readonly setPermissions: (
    handle: H,
    executable: boolean,
  ) => IOResult<undefined>;
  readonly close: (handle: H) => IOResult<undefined>;
  readonly replace: (
    temporary: string,
    destination: string,
  ) => IOResult<undefined>;
  readonly remove: (path: string) => IOResult<undefined>;
}
export type Operation =
  | "open"
  | "read"
  | "create"
  | "write"
  | "permissions"
  | "close"
  | "replace"
  | "remove";
export interface OperationError {
  readonly operation: Operation;
  readonly cause: IOError;
}
export type FileResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: OperationError;
      readonly temporaryPath?: string;
      readonly cleanup: readonly OperationError[];
    };

export function readFile<H>(
  host: FileHost<H>,
  path: string,
  maxByteLength: number,
): FileResult<Uint8Array> {
  if (
    !Number.isInteger(maxByteLength) ||
    maxByteLength < 0 ||
    maxByteLength > 0xffffffff
  )
    return {
      ok: false,
      error: { operation: "read", cause: { kind: "invalid-limit" } },
      cleanup: [],
    };
  const opened = host.openRead(path);
  if (!opened.ok)
    return {
      ok: false,
      error: { operation: "open", cause: opened.error },
      cleanup: [],
    };
  const handle = opened.value;
  let content: IOResult<Uint8Array> = {
    ok: false,
    error: { kind: "no-progress" },
  };
  let closed: IOResult<undefined> = { ok: true, value: undefined };
  try {
    content = readAll((buffer) => host.read(handle, buffer), maxByteLength);
  } finally {
    closed = host.close(handle);
  }
  if (!content.ok) {
    const cleanup: OperationError[] = [];
    if (!closed.ok) cleanup.push({ operation: "close", cause: closed.error });
    return {
      ok: false,
      error: { operation: "read", cause: content.error },
      cleanup,
    };
  }
  if (!closed.ok)
    return {
      ok: false,
      error: { operation: "close", cause: closed.error },
      cleanup: [],
    };
  return content;
}
export function publishFile<H>(
  host: FileHost<H>,
  destination: string,
  bytes: Uint8Array,
  executable: boolean,
): FileResult<undefined> {
  const created = host.createTemporary(destination);
  if (!created.ok)
    return {
      ok: false,
      error: { operation: "create", cause: created.error },
      cleanup: [],
    };
  const temp = created.value,
    cleanup: OperationError[] = [];
  let failure: OperationError | undefined,
    closed = false,
    published = false;
  try {
    const written = writeAll(
      (buffer) => host.write(temp.handle, buffer),
      bytes,
    );
    if (!written.ok) failure = { operation: "write", cause: written.error };
    if (failure === undefined) {
      const mode = host.setPermissions(temp.handle, executable);
      if (!mode.ok) failure = { operation: "permissions", cause: mode.error };
    }
    if (failure === undefined) {
      // Never retry close: an error can leave descriptor ownership ambiguous.
      closed = true;
      const result = host.close(temp.handle);
      if (!result.ok) failure = { operation: "close", cause: result.error };
    }
    if (failure === undefined) {
      const result = host.replace(temp.path, destination);
      if (!result.ok) failure = { operation: "replace", cause: result.error };
      else published = true;
    }
  } finally {
    try {
      if (!closed) {
        closed = true;
        const result = host.close(temp.handle);
        if (!result.ok)
          cleanup.push({ operation: "close", cause: result.error });
      }
    } finally {
      if (!published) {
        const result = host.remove(temp.path);
        if (!result.ok)
          cleanup.push({ operation: "remove", cause: result.error });
      }
    }
  }
  if (failure !== undefined)
    return { ok: false, error: failure, cleanup, temporaryPath: temp.path };
  return { ok: true, value: undefined };
}
