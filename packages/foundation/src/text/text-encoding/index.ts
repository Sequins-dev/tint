export { escapeUTF16, unescapeUTF16 } from "./legacy-uri.ts";
export {
  encodeURIString,
  decodeURIString,
  type URIEncodingResult,
} from "./uri.ts";
export { isWellFormedUTF16, toWellFormedUTF16 } from "./well-formed.ts";
import {
  asciiEndOfBytes,
  asciiEndOfText,
  copyLatin1,
  latin1Text,
} from "../latin1.ts";
import { utf8ByteLength, utf8Text, utf8WholeText, writeUTF8 } from "../utf8.ts";
/** Native implementations behind standard encoding globals. Node hosts keep their
 * built-in TextEncoder/TextDecoder; these functions are the native runtime core.
 * ASCII moves as one scan and one copy through the Latin-1 primitives
 * (../latin1.ts), other strings and valid input in bulk through the UTF-8
 * primitives (../utf8.ts); only what follows an invalid or split sequence
 * takes the byte state machine. */
export interface EncodeResult {
  readonly read: number;
  readonly written: number;
}

/** Start at a UTF-16 offset within the input. Counts are relative to that
 * offset. A scalar that does not fit is left for the next call. */
export function encodeUTF8Into(
  value: string,
  destination: Uint8Array,
  start: number = 0,
): EncodeResult {
  const length = value.length;
  if (!Number.isInteger(start) || start < 0 || start >= length)
    return { read: 0, written: 0 };
  const next = writeUTF8(value, start, length, destination, 0);
  return { read: next - start, written: utf8ByteLength(value, start, next) };
}
export function encodeUTF8(value: string): Uint8Array {
  const length = value.length;
  // ASCII text is its own encoding: one scan and one copy.
  if (asciiEndOfText(value, 0, length) === length) {
    const ascii = new Uint8Array(length);
    copyLatin1(value, 0, length, ascii, 0);
    return ascii;
  }
  const output = new Uint8Array(utf8ByteLength(value, 0, length));
  writeUTF8(value, 0, length, output, 0);
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
  if (state.needed !== 0) return decodeSequences(state, input, 0, "", stream);
  // Outside a sequence, the valid run from the start (after a dropped byte
  // order mark) decodes in bulk; only what follows it needs the state
  // machine.
  const length = input.length;
  let begin = 0;
  if (
    !state.bomSeen &&
    !state.ignoreBOM &&
    length >= 3 &&
    input[0] === 0xef &&
    input[1] === 0xbb &&
    input[2] === 0xbf
  )
    begin = 3;
  // ASCII input is its own text: one scan and one copy.
  if (asciiEndOfBytes(input, begin, length) === length) {
    if (length > 0) state.bomSeen = true;
    return latin1Text(input, begin, length);
  }
  // Other valid input decodes in one bulk call ("" otherwise, which a
  // nonempty valid range never decodes to).
  const whole = utf8WholeText(input, begin, length);
  if (whole.length > 0 || begin === length) {
    if (length > 0) state.bomSeen = true;
    return whole;
  }
  const text = utf8Text(input, begin, length),
    // One unit per byte only when every byte was ASCII.
    end =
      text.length === length - begin
        ? length
        : begin + utf8ByteLength(text, 0, text.length);
  if (end > 0) state.bomSeen = true;
  return decodeSequences(state, input, end, text, stream);
}
/** Decodes input from `index` with the byte state machine (continuing
 * `state`'s pending sequence), after the already decoded `prefix`. */
function decodeSequences(
  state: UTF8Decoder,
  input: Uint8Array,
  index: number,
  prefix: string,
  stream: boolean,
): string | undefined {
  const length = input.length;
  // The decoded pieces, joined once: one copy of each unit.
  let bomSeen = state.bomSeen;
  const parts: string[] = prefix === "" ? [] : [prefix];
  function append(point: number): void {
    if (!bomSeen) {
      bomSeen = true;
      if (!state.ignoreBOM && point === 0xfeff) return;
    }
    parts.push(String.fromCodePoint(point));
  }
  for (; index < length; index++) {
    const byte = input[index];
    if (byte === undefined) throw "UTF8_INPUT_INVARIANT";
    if (state.needed === 0) {
      if (byte <= 0x7f) {
        // The ASCII run from here, in bulk.
        const end = asciiEndOfBytes(input, index + 1, length);
        bomSeen = true;
        parts.push(latin1Text(input, index, end));
        index = end - 1;
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
  return parts.join("");
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
