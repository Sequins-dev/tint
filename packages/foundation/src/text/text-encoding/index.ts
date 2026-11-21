export { escapeUTF16, unescapeUTF16 } from "./legacy-uri.ts";
export {
  encodeURIString,
  decodeURIString,
  type URIEncodingResult,
} from "./uri.ts";
export { isWellFormedUTF16, toWellFormedUTF16 } from "./well-formed.ts";
import {
  createStringBuilder,
  appendString,
  finishString,
} from "../string-builder.ts";
/** Native implementations behind standard encoding globals. Node hosts keep their
 * built-in TextEncoder/TextDecoder; these functions are the native runtime core. */
function scalarAt(value: string, index: number, first: number): number {
  if (first < 0xd800 || first > 0xdfff) return first;
  if (first < 0xdc00 && index + 1 < value.length) {
    const second = value.charCodeAt((index + 1) >>> 0) & 0xffff;
    if (second >= 0xdc00 && second <= 0xdfff)
      return 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
  }
  return 0xfffd;
}
function width(point: number): number {
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  if (point < 0x10000) return 3;
  return 4;
}
export interface EncodeResult {
  readonly read: number;
  readonly written: number;
}

export const utf8WindowBytes = 4096;
export const utf8WindowCountBits = 13;

/** Portable implementation of the native utf8-window operation. Each window
 * writes at most 4 KiB. The packed result contains two exact integer counts. */
export function encodeUTF8Window(
  value: string,
  destination: Uint8Array,
  start: number,
  offset: number,
): number {
  const end = value.length;
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start >= end ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= destination.length
  )
    return 0;
  const limit = Math.min(destination.length, offset + utf8WindowBytes);
  let read = start;
  let written = offset;
  for (; read < end && written < limit; read++) {
    const first = value.charCodeAt(read >>> 0) & 0xffff;
    if (first < 0x80) {
      destination[written] = first;
      written++;
      continue;
    }
    const point = scalarAt(value, read, first);
    const bytes = width(point);
    if (bytes > limit - written) break;
    if (bytes === 2) {
      destination[written] = 0xc0 | (point >>> 6);
      destination[written + 1] = 0x80 | (point & 63);
    } else if (bytes === 3) {
      destination[written] = 0xe0 | (point >>> 12);
      destination[written + 1] = 0x80 | ((point >>> 6) & 63);
      destination[written + 2] = 0x80 | (point & 63);
    } else {
      destination[written] = 0xf0 | (point >>> 18);
      destination[written + 1] = 0x80 | ((point >>> 12) & 63);
      destination[written + 2] = 0x80 | ((point >>> 6) & 63);
      destination[written + 3] = 0x80 | (point & 63);
    }
    if (point > 0xffff) read++;
    written += bytes;
  }
  return ((read - start) << utf8WindowCountBits) | (written - offset);
}

/** Start at a UTF-16 offset within the input. Counts are relative to that
 * offset. A scalar that does not fit is left for the next call. */
export function encodeUTF8Into(
  value: string,
  destination: Uint8Array,
  start: number = 0,
): EncodeResult {
  const windowCountMask = (1 << utf8WindowCountBits) - 1;
  let read = start;
  let written = 0;
  while (read < value.length && written < destination.length) {
    const finalWindow = destination.length - written <= utf8WindowBytes;
    const result = encodeUTF8Window(value, destination, read, written);
    if (result === 0) break;
    read += result >>> utf8WindowCountBits;
    written += result & windowCountMask;
    if (finalWindow) break;
  }
  return { read: read - start, written };
}
export function encodeUTF8(value: string): Uint8Array {
  let bytes = 0;
  let highSurrogate = false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index) & 0xffff;
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    // The high surrogate already contributed three bytes. A matching low
    // surrogate brings the pair to four instead of encoding a replacement.
    else if (highSurrogate && unit >= 0xdc00 && unit <= 0xdfff) bytes++;
    else bytes += 3;
    highSurrogate = unit >= 0xd800 && unit < 0xdc00;
  }
  const output = new Uint8Array(bytes);
  encodeUTF8Into(value, output);
  return output;
}

export interface UTF8Decoder {
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  streaming: boolean;
  bomSeen: boolean;
  point: number;
  needed: number;
  seen: number;
  lower: number;
  upper: number;
}
export function createUTF8Decoder(
  fatal: boolean = false,
  ignoreBOM: boolean = false,
): UTF8Decoder {
  return {
    fatal,
    ignoreBOM,
    streaming: false,
    bomSeen: false,
    point: 0,
    needed: 0,
    seen: 0,
    lower: 0x80,
    upper: 0xbf,
  };
}
function resetSequence(state: UTF8Decoder): void {
  state.point = 0;
  state.needed = 0;
  state.seen = 0;
  state.lower = 0x80;
  state.upper = 0xbf;
}
/** Undefined is the internal fatal-error result. The standard-global adapter must
 * throw TypeError; the core does not substitute a differently branded exception. */
export function decodeUTF8(
  state: UTF8Decoder,
  input: Uint8Array,
  stream: boolean = false,
): string | undefined {
  if (!state.streaming) {
    resetSequence(state);
    state.bomSeen = false;
  }
  state.streaming = stream;
  let bomSeen = state.bomSeen,
    chunk = "";
  const chunks = createStringBuilder();
  function append(point: number): void {
    if (!bomSeen) {
      bomSeen = true;
      if (!state.ignoreBOM && point === 0xfeff) return;
    }
    chunk += String.fromCodePoint(point);
    if (chunk.length >= 32) {
      appendString(chunks, chunk);
      chunk = "";
    }
  }
  for (let index = 0; index < input.length; index++) {
    const byte = input[index];
    if (byte === undefined) throw "UTF8_INPUT_INVARIANT";
    if (state.needed === 0) {
      if (byte <= 0x7f) {
        append(byte);
        continue;
      }
      if (byte >= 0xc2 && byte <= 0xdf) {
        state.needed = 1;
        state.point = byte & 31;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        state.needed = 2;
        state.point = byte & 15;
        if (byte === 0xe0) state.lower = 0xa0;
        if (byte === 0xed) state.upper = 0x9f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        state.needed = 3;
        state.point = byte & 7;
        if (byte === 0xf0) state.lower = 0x90;
        if (byte === 0xf4) state.upper = 0x8f;
      } else {
        if (state.fatal) return undefined;
        append(0xfffd);
      }
      continue;
    }
    if (byte < state.lower || byte > state.upper) {
      resetSequence(state);
      if (state.fatal) return undefined;
      append(0xfffd);
      index--;
      continue;
    }
    state.lower = 0x80;
    state.upper = 0xbf;
    state.point = (state.point << 6) | (byte & 63);
    state.seen++;
    if (state.seen === state.needed) {
      const point = state.point;
      resetSequence(state);
      append(point);
    }
  }
  if (!stream && state.needed !== 0) {
    resetSequence(state);
    if (state.fatal) return undefined;
    append(0xfffd);
  }
  state.bomSeen = bomSeen;
  appendString(chunks, chunk);
  return finishString(chunks);
}

export interface NativeTextEncoder {
  readonly encoding: "utf-8";
  readonly encode: (input?: string) => Uint8Array;
  readonly encodeInto: (input: string, destination: Uint8Array) => EncodeResult;
}
export function createNativeTextEncoder(): NativeTextEncoder {
  return {
    encoding: "utf-8",
    encode: (input: string = "") => encodeUTF8(input),
    encodeInto: (input, destination) => encodeUTF8Into(input, destination),
  };
}
export interface DecoderOptions {
  readonly fatal?: boolean;
  readonly ignoreBOM?: boolean;
}
export interface DecodeOptions {
  readonly stream?: boolean;
}
export interface NativeTextDecoder {
  readonly encoding: "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  readonly decode: (input?: Uint8Array, options?: DecodeOptions) => string;
}
function asciiSpace(unit: number): boolean {
  return unit === 9 || unit === 10 || unit === 12 || unit === 13 || unit === 32;
}
function encodingLabel(label: string): string {
  let first = 0,
    last = label.length;
  while (first < last && asciiSpace(label.charCodeAt(first))) first++;
  while (last > first && asciiSpace(label.charCodeAt(last - 1))) last--;
  let result = "";
  for (const character of label.substring(first, last)) {
    const unit = character.charCodeAt(0);
    result +=
      unit >= 65 && unit <= 90 ? String.fromCharCode(unit + 32) : character;
  }
  return result;
}
/** UTF-8-only standard-global surface for the native bootstrap. */
export function createNativeTextDecoder(
  label: string = "utf-8",
  options: DecoderOptions | undefined = undefined,
): NativeTextDecoder {
  const name = encodingLabel(label);
  if (name !== "utf-8" && name !== "utf8" && name !== "unicode-1-1-utf-8")
    throw new RangeError("Unsupported encoding label");
  const fatal = options?.fatal ?? false,
    ignoreBOM = options?.ignoreBOM ?? false;
  const state = createUTF8Decoder(fatal, ignoreBOM);
  return {
    encoding: "utf-8",
    fatal,
    ignoreBOM,
    decode: (
      input: Uint8Array = new Uint8Array(0),
      options: DecodeOptions | undefined = undefined,
    ): string => {
      const value = decodeUTF8(state, input, options?.stream ?? false);
      if (value === undefined) throw new TypeError("Invalid UTF-8 data");
      return value;
    },
  };
}
