export interface HostError {
  readonly kind: "host";
  readonly code: string;
  readonly interrupted: boolean;
}
export type IOError =
  | HostError
  | {
      readonly kind:
        "invalid-count" | "no-progress" | "limit" | "invalid-limit";
    };
export type IOResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IOError };
export type Reader = (destination: Uint8Array) => IOResult<number>;
export type Writer = (source: Uint8Array) => IOResult<number>;

function count(n: number, limit: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= limit;
}
export function readAll(
  read: Reader,
  maxByteLength: number,
): IOResult<Uint8Array> {
  if (!count(maxByteLength, 0xffffffff))
    return { ok: false, error: { kind: "invalid-limit" } };
  const capacity = maxByteLength < 65536 ? maxByteLength + 1 : 65536;
  const buffer = new Uint8Array(capacity),
    chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const remaining = maxByteLength - total,
      requested = remaining < capacity ? remaining + 1 : capacity;
    const result = read(buffer.subarray(0, requested));
    if (!result.ok) {
      const error = result.error;
      if (error.kind === "host" && error.interrupted) continue;
      return result;
    }
    const n = result.value;
    if (!count(n, requested))
      return { ok: false, error: { kind: "invalid-count" } };
    if (n === 0) break;
    if (n > remaining) return { ok: false, error: { kind: "limit" } };
    chunks.push(new Uint8Array(buffer.subarray(0, n)));
    total += n;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk === undefined) throw "read chunk invariant";
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, value: bytes };
}
export function writeAll(write: Writer, bytes: Uint8Array): IOResult<number> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = write(bytes.subarray(offset));
    if (!result.ok) {
      const error = result.error;
      if (error.kind === "host" && error.interrupted) continue;
      return result;
    }
    if (!count(result.value, bytes.length - offset))
      return { ok: false, error: { kind: "invalid-count" } };
    if (result.value === 0)
      return { ok: false, error: { kind: "no-progress" } };
    offset += result.value;
  }
  return { ok: true, value: offset };
}
