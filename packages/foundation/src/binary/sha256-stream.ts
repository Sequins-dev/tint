import {
  compressSha256,
  readSha256Word as word,
} from "./sha256-compression.ts";
/** Incremental SHA-256 (FIPS 180-4): absorb byte chunks in order, then
 * finish once. Fixed-size state (no input copies beyond one partial block),
 * the same compression as the one-shot `sha256` (`./sha256.ts`), so native
 * builds that bind the `sha256-rounds` intrinsic use it here too. */
export interface Sha256Stream {
  /** The eight chaining words. */
  readonly state: Uint32Array;
  /** Message schedule scratch (64 words). */
  readonly schedule: Uint32Array;
  /** The partial block not yet compressed (its first `pending` bytes). */
  readonly block: Uint8Array;
  pending: number;
  /** Bytes absorbed so far. */
  length: number;
  finished: boolean;
}
export function createSha256Stream(): Sha256Stream {
  const state = new Uint32Array(8);
  state[0] = 0x6a09e667;
  state[1] = 0xbb67ae85;
  state[2] = 0x3c6ef372;
  state[3] = 0xa54ff53a;
  state[4] = 0x510e527f;
  state[5] = 0x9b05688c;
  state[6] = 0x1f83d9ab;
  state[7] = 0x5be0cd19;
  return {
    state,
    schedule: new Uint32Array(64),
    block: new Uint8Array(64),
    pending: 0,
    length: 0,
    finished: false,
  };
}
/** Compress the 64 bytes of `bytes` at `offset` into the state. */
function compressBlock(
  stream: Sha256Stream,
  bytes: Uint8Array,
  offset: number,
): void {
  const schedule = stream.schedule;
  for (let i = 0, pos = offset; i < 16; i++, pos += 4) {
    const b0 = bytes[pos],
      b1 = bytes[pos + 1],
      b2 = bytes[pos + 2],
      b3 = bytes[pos + 3];
    if (
      b0 === undefined ||
      b1 === undefined ||
      b2 === undefined ||
      b3 === undefined
    )
      throw "SHA-256 block outside its view";
    schedule[i] = b0 * 16777216 + b1 * 65536 + b2 * 256 + b3;
  }
  compressSha256(stream.state, schedule);
}
/** Absorb `input` (not retained or modified). */
export function updateSha256Stream(
  stream: Sha256Stream,
  input: Uint8Array,
): void {
  if (stream.finished) throw "SHA-256 stream already finished";
  const length = input.length;
  stream.length += length;
  let offset = 0;
  const block = stream.block;
  if (stream.pending > 0) {
    while (stream.pending < 64 && offset < length) {
      const value = input[offset];
      if (value === undefined) throw "SHA-256 input view changed";
      block[stream.pending] = value;
      stream.pending++;
      offset++;
    }
    if (stream.pending < 64) return;
    compressBlock(stream, block, 0);
    stream.pending = 0;
  }
  // Whole blocks straight from the input.
  for (; offset + 64 <= length; offset += 64)
    compressBlock(stream, input, offset);
  for (; offset < length; offset++) {
    const value = input[offset];
    if (value === undefined) throw "SHA-256 input view changed";
    block[stream.pending] = value;
    stream.pending++;
  }
}
/** Pad, compress the final block(s) and return the 32 digest bytes. The
 * stream accepts no further input. */
export function finishSha256Stream(stream: Sha256Stream): Uint8Array {
  if (stream.finished) throw "SHA-256 stream already finished";
  stream.finished = true;
  const block = stream.block;
  let pending = stream.pending;
  block[pending] = 0x80;
  pending++;
  if (pending > 56) {
    for (; pending < 64; pending++) block[pending] = 0;
    compressBlock(stream, block, 0);
    pending = 0;
  }
  for (; pending < 56; pending++) block[pending] = 0;
  // The message length in bits as a big-endian 64-bit integer.
  const bitLengthLo = (stream.length * 8) >>> 0;
  const bitLengthHi = Math.floor(stream.length / 0x20000000);
  for (let n = 0; n < 4; n++) {
    block[56 + n] = (bitLengthHi >>> ((3 - n) * 8)) & 255;
    block[60 + n] = (bitLengthLo >>> ((3 - n) * 8)) & 255;
  }
  compressBlock(stream, block, 0);
  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 4; j++)
      digest[i * 4 + j] = (word(stream.state, i) >>> ((3 - j) * 8)) & 255;
  return digest;
}
