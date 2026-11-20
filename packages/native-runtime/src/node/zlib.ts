/** `node:zlib` synchronous codecs over the system zlib (docs/native-ffi.md,
 * "zlib"): deflateSync, inflateSync, deflateRawSync, inflateRawSync,
 * gzipSync, gunzipSync and unzipSync with Node's options, chunking and
 * error behaviour. Results are Uint8Arrays (Node returns Buffers).
 *
 * zlib keeps `strm->state->strm == strm` and retains next_in/next_out
 * across calls, and this code allocates (output chunks) between calls, so
 * a collection may run between any two of them. The z_stream, the input
 * copy and the output window therefore live in one block of external
 * storage, which never moves; every zlib call is a leaf c-call, and the
 * z_stream's members are read and written as properties of a C view of the
 * block (docs/native-ffi.md, "C views"). The block is released (and the
 * stream ended) on every exit.
 */
import {
  z_stream,
  zlibVersion,
  deflateInit2_,
  deflate,
  deflateEnd,
  inflateInit2_,
  inflate,
  inflateReset,
  inflateEnd,
} from "tint:c/zlib";
import { memcpy, memcpy$into, memcpy$bytes } from "tint:c/memory";
import { allocate, release, address, type View } from "tint:ffi";
import { cStringAt } from "tint:ffi/unsafe";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import {
  codedError,
  codedRangeError,
  type NativeCodedError,
} from "./errors.ts";

/** Node's options for the synchronous codecs. */
export interface ZlibOptions {
  level?: number;
  windowBits?: number;
  memLevel?: number;
  strategy?: number;
  chunkSize?: number;
  finishFlush?: number;
  maxOutputLength?: number;
}
const noFlush = 0,
  blockFlush = 5,
  finish = 4;
const ok = 0,
  streamEnd = 1,
  needDictionary = 2,
  bufferError = -5;
/** Node's codec modes (lib/internal/zlib constants). */
const deflateMode = 1,
  inflateMode = 2,
  gzipMode = 3,
  gunzipMode = 4,
  deflateRawMode = 5,
  inflateRawMode = 6,
  unzipMode = 7;
/** Node's kMaxLength (2^53 - 1 on 64-bit). */
const maximumOutput = 9007199254740991;

/** Node's checkRangesOrGetDefault: undefined and NaN take the default;
 * other non-finite values and values outside [lower, upper] throw
 * RangeError (ERR_OUT_OF_RANGE) with Node's message. */
function option(
  value: number | undefined,
  name: string,
  lower: number,
  upper: number,
  fallback: number,
): number {
  if (value === undefined || value !== value) return fallback;
  if (value === Infinity || value === -Infinity)
    throw codedRangeError(
      'The value of "' +
        name +
        '" is out of range. It must be a finite number. Received ' +
        String(value),
      "ERR_OUT_OF_RANGE",
    );
  if (value < lower || value > upper)
    throw codedRangeError(
      'The value of "' +
        name +
        '" is out of range. It must be >= ' +
        String(lower) +
        " and <= " +
        String(upper) +
        ". Received " +
        String(value),
      "ERR_OUT_OF_RANGE",
    );
  return value;
}
/** Node passes options to C++ as int32 (truncating fractions). */
function int32(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}
/** Node's message for a failed call: zlib's own message when it set one. */
function statusCode(status: number): string {
  switch (status) {
    case 2:
      return "Z_NEED_DICT";
    case -1:
      return "Z_ERRNO";
    case -2:
      return "Z_STREAM_ERROR";
    case -3:
      return "Z_DATA_ERROR";
    case -4:
      return "Z_MEM_ERROR";
    case -5:
      return "Z_BUF_ERROR";
    case -6:
      return "Z_VERSION_ERROR";
    default:
      return "Z_UNKNOWN";
  }
}
function failure(
  stream: View<z_stream>,
  status: number,
  fallback: string,
): NativeCodedError {
  const message = stream.msg;
  return codedError(
    message === 0 ? fallback : cStringAt(message),
    statusCode(status),
    status,
  );
}

function process(
  input: string | Uint8Array,
  options: ZlibOptions | undefined,
  mode: number,
): Uint8Array {
  const settings: ZlibOptions = options ?? {};
  const inflating =
    mode === inflateMode ||
    mode === gunzipMode ||
    mode === inflateRawMode ||
    mode === unzipMode;
  // windowBits 0 (or absent) lets inflate use the stream's header.
  let windowBits = 15;
  if (
    (settings.windowBits === undefined || settings.windowBits === 0) &&
    (mode === inflateMode || mode === gunzipMode || mode === unzipMode)
  )
    windowBits = 0;
  else
    windowBits = int32(
      option(
        settings.windowBits,
        "options.windowBits",
        mode === gzipMode ? 9 : 8,
        15,
        15,
      ),
    );
  const level = int32(option(settings.level, "options.level", -1, 9, -1)),
    memLevel = int32(option(settings.memLevel, "options.memLevel", 1, 9, 8)),
    strategy = int32(option(settings.strategy, "options.strategy", 0, 4, 0));
  const finishFlush = int32(
    option(
      settings.finishFlush,
      "options.finishFlush",
      noFlush,
      blockFlush,
      finish,
    ),
  );
  let chunkSize = 16384;
  const requestedChunk = settings.chunkSize;
  if (requestedChunk !== undefined && requestedChunk === requestedChunk) {
    if (requestedChunk === Infinity || requestedChunk === -Infinity)
      throw codedRangeError(
        'The value of "options.chunkSize" is out of range. It must be a finite number. Received ' +
          String(requestedChunk),
        "ERR_OUT_OF_RANGE",
      );
    if (requestedChunk < 64)
      throw codedRangeError(
        'The value of "options.chunkSize" is out of range. It must be >= 64. Received ' +
          String(requestedChunk),
        "ERR_OUT_OF_RANGE",
      );
    chunkSize = Math.floor(requestedChunk);
  }
  const maxOutput = option(
    settings.maxOutputLength,
    "options.maxOutputLength",
    1,
    maximumOutput,
    maximumOutput,
  );
  const bytes = typeof input === "string" ? encodeUTF8(input) : input;
  // Node's native initialization adjusts the window bits per mode.
  if (mode === gzipMode || mode === gunzipMode) windowBits += 16;
  else if (mode === unzipMode) windowBits += 32;
  else if (mode === deflateRawMode || mode === inflateRawMode) {
    // zlib rejects a raw 8-bit window it would widen to 9 when wrapped.
    if (mode === deflateRawMode && windowBits === 8) windowBits = 9;
    windowBits = -windowBits;
  }
  // One external block: the z_stream, the input copy and the output window.
  const inputOffset = Math.ceil(z_stream.size / 16) * 16,
    outputOffset = inputOffset + Math.ceil(bytes.length / 16) * 16;
  const block = allocate(outputOffset + chunkSize),
    base = address(block),
    stream = z_stream.view(block);
  let started = false;
  try {
    if (bytes.length > 0) memcpy$into(base + inputOffset, bytes, bytes.length);
    const initialized = inflating
      ? inflateInit2_(stream, windowBits, zlibVersion(), z_stream.size)
      : deflateInit2_(
          stream,
          level,
          8,
          windowBits,
          memLevel,
          strategy,
          zlibVersion(),
          z_stream.size,
        );
    if (initialized !== ok)
      throw failure(stream, initialized, "Initialization failed");
    started = true;
    const chunks: Uint8Array[] = [];
    let produced = 0,
      consumed = 0;
    let availableIn = bytes.length;
    for (;;) {
      stream.next_in = base + inputOffset + consumed;
      stream.avail_in = availableIn;
      stream.next_out = base + outputOffset;
      stream.avail_out = chunkSize;
      let status = inflating
        ? inflate(stream, finishFlush)
        : deflate(stream, finishFlush);
      // Node's gunzip continues with further members (trailing zero bytes
      // are padding, anything else must be another member).
      while (
        mode === gunzipMode &&
        status === streamEnd &&
        stream.avail_in > 0 &&
        (block[inputOffset + bytes.length - stream.avail_in] ?? 0) !== 0
      ) {
        inflateReset(stream);
        status = inflate(stream, finishFlush);
      }
      const availableOut = stream.avail_out;
      if (status === ok || status === bufferError) {
        if (availableOut !== 0 && finishFlush === finish)
          throw codedError(
            "unexpected end of file",
            "Z_BUF_ERROR",
            bufferError,
          );
      } else if (status === needDictionary)
        throw codedError("Missing dictionary", "Z_NEED_DICT", status);
      else if (status !== streamEnd)
        throw failure(stream, status, "Zlib error");
      const remaining = stream.avail_in;
      consumed += availableIn - remaining;
      availableIn = remaining;
      const have = chunkSize - availableOut;
      if (have > 0) {
        const chunk = new Uint8Array(have);
        memcpy(chunk, base + outputOffset, have);
        chunks.push(chunk);
        produced += have;
        if (produced > maxOutput)
          throw codedRangeError(
            "Cannot create a Buffer larger than " +
              String(maxOutput) +
              " bytes",
            "ERR_BUFFER_TOO_LARGE",
          );
      }
      // An exhausted output window means zlib has more to write.
      if (availableOut !== 0) break;
    }
    const first = chunks[0];
    if (chunks.length === 1 && first !== undefined) return first;
    const result = new Uint8Array(produced);
    let offset = 0;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (chunk === undefined) throw new RangeError("zlib chunk invariant");
      memcpy$bytes(result.subarray(offset), chunk, chunk.length);
      offset += chunk.length;
    }
    return result;
  } finally {
    if (started) {
      if (inflating) inflateEnd(stream);
      else deflateEnd(stream);
    }
    release(block);
  }
}
export function deflateSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, deflateMode);
}
export function inflateSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, inflateMode);
}
export function deflateRawSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, deflateRawMode);
}
export function inflateRawSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, inflateRawMode);
}
export function gzipSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, gzipMode);
}
export function gunzipSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, gunzipMode);
}
export function unzipSync(
  input: string | Uint8Array,
  options?: ZlibOptions,
): Uint8Array {
  return process(input, options, unzipMode);
}
