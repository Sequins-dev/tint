export type PositionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: "INVALID_OFFSET" | "NOT_BOUNDARY" | "INVALID_POSITION";
    };
export interface Position {
  readonly line: number;
  readonly column: number;
}
/** Immutable character source, including strings that are not well-formed UTF-16.
 * Parsing and locations require no byte encoding or lossy Unicode conversion. */
export interface SourceTextView {
  readonly text: string;
  readonly lineCount: number;
  readonly positionAt: (utf16Offset: number) => PositionResult<Position>;
  readonly offsetAt: (line: number, column: number) => PositionResult<number>;
}
export interface SourceText extends SourceTextView {
  readonly byteLength: number;
  readonly copyBytes: () => Uint8Array;
  readonly byteToUtf16: (offset: number) => PositionResult<number>;
  readonly utf16ToByte: (offset: number) => PositionResult<number>;
}
export type SourceError =
  | { readonly kind: "invalid-limit" | "size-limit" }
  | {
      readonly kind: "invalid-utf8";
      readonly byteOffset: number;
      readonly sequenceStart: number;
    };
export type SourceResult =
  | { readonly ok: true; readonly value: SourceText }
  | { readonly ok: false; readonly error: SourceError };

interface Span {
  readonly byte: number;
  readonly utf16: number;
  readonly bytes: number;
  readonly units: number;
}
function valid(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= max;
}
function convert(
  spans: readonly Span[],
  offset: number,
  limit: number,
  toByte: boolean,
): PositionResult<number> {
  if (!valid(offset, limit)) return { ok: false, error: "INVALID_OFFSET" };
  let lo = 0,
    hi = spans.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2),
      span = spans[mid];
    if (span === undefined) throw "source span invariant";
    if ((toByte ? span.utf16 : span.byte) <= offset) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return { ok: true, value: offset };
  const span = spans[lo - 1];
  if (span === undefined) throw "source span invariant";
  const start = toByte ? span.utf16 : span.byte,
    target = toByte ? span.byte : span.utf16;
  const length = toByte ? span.units : span.bytes,
    targetLength = toByte ? span.bytes : span.units;
  if (offset === start) return { ok: true, value: target };
  if (offset < start + length) return { ok: false, error: "NOT_BOUNDARY" };
  return { ok: true, value: target + targetLength + offset - start - length };
}
// The standard decoder owns UTF-8 validation. Replaying only failed inputs in
// streaming mode locates the first error without a second decoding algorithm.
function decodingError(bytes: Uint8Array): SourceError {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let sequenceStart = 0;
  for (let offset = 0; offset < bytes.length; offset++) {
    try {
      if (
        decoder.decode(bytes.subarray(offset, offset + 1), { stream: true })
          .length > 0
      )
        sequenceStart = offset + 1;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return { kind: "invalid-utf8", byteOffset: offset, sequenceStart };
    }
  }
  try {
    decoder.decode();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { kind: "invalid-utf8", byteOffset: bytes.length, sequenceStart };
  }
  throw "inconsistent standard decoder failure";
}
export function createSourceText(
  bytes: Uint8Array,
  maxByteLength: number,
): SourceResult {
  if (!valid(maxByteLength, 0xffffffff))
    return { ok: false, error: { kind: "invalid-limit" } };
  if (bytes.length > maxByteLength)
    return { ok: false, error: { kind: "size-limit" } };
  const snapshot = new Uint8Array(bytes);
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      snapshot,
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { ok: false, error: decodingError(snapshot) };
  }
  const spans: Span[] = [];
  let byte = 0;
  for (let utf16 = 0; utf16 < text.length;) {
    const unit = text.charCodeAt(utf16),
      units = unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
    // UTF-8 length from the code unit. Fatal decoding admits no lone
    // surrogates, so a high surrogate always starts a 4-byte pair; the
    // round-trip check below still guards the total.
    const length = units === 2 ? 4 : unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    if (length !== units) spans.push({ byte, utf16, bytes: length, units });
    byte += length;
    utf16 += units;
  }
  if (byte !== snapshot.length) throw "standard encoding round-trip invariant";
  const view = createSourceTextView(text);
  return {
    ok: true,
    value: {
      text,
      byteLength: snapshot.length,
      lineCount: view.lineCount,
      copyBytes: () => new Uint8Array(snapshot),
      byteToUtf16: (offset) => convert(spans, offset, snapshot.length, false),
      utf16ToByte: (offset) => convert(spans, offset, text.length, true),
      positionAt: view.positionAt,
      offsetAt: view.offsetAt,
    },
  };
}

/** Keep runtime source strings exact. Byte ownership and UTF-8 validation belong
 * to createSourceText; both inputs share the same UTF-16 location contract. */
export function createSourceTextView(text: string): SourceTextView {
  const lines = [0];
  for (let offset = 0; offset < text.length; offset++) {
    const unit = text.charCodeAt(offset);
    if (unit === 13) {
      if (text.charCodeAt(offset + 1) === 10) offset++;
      lines.push(offset + 1);
    } else if (unit === 10 || unit === 0x2028 || unit === 0x2029)
      lines.push(offset + 1);
  }
  function positionAt(offset: number): PositionResult<Position> {
    if (!valid(offset, text.length))
      return { ok: false, error: "INVALID_OFFSET" };
    let lo = 0,
      hi = lines.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2),
        start = lines[mid];
      if (start === undefined) throw "source line invariant";
      if (start <= offset) lo = mid + 1;
      else hi = mid;
    }
    const start = lines[lo - 1];
    if (start === undefined) throw "source line invariant";
    return { ok: true, value: { line: lo, column: offset - start + 1 } };
  }
  function offsetAt(line: number, column: number): PositionResult<number> {
    if (
      !valid(line, lines.length) ||
      line === 0 ||
      !valid(column, text.length + 1) ||
      column === 0
    )
      return { ok: false, error: "INVALID_POSITION" };
    const start = lines[line - 1],
      next = lines[line];
    if (start === undefined) throw "source line invariant";
    const end = next === undefined ? text.length : next - 1;
    if (column - 1 > end - start)
      return { ok: false, error: "INVALID_POSITION" };
    return { ok: true, value: start + column - 1 };
  }
  return { text, lineCount: lines.length, positionAt, offsetAt };
}
