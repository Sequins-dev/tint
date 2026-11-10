import {
  compressSha256,
  readSha256Word as word,
} from "./sha256-compression.ts";
/** One-shot SHA-256. Constant auxiliary storage; no input copy or mutation. */
export function sha256(input: Uint8Array): Uint8Array {
  const state = new Uint32Array(8);
  state[0] = 0x6a09e667;
  state[1] = 0xbb67ae85;
  state[2] = 0x3c6ef372;
  state[3] = 0xa54ff53a;
  state[4] = 0x510e527f;
  state[5] = 0x9b05688c;
  state[6] = 0x1f83d9ab;
  state[7] = 0x5be0cd19;
  const schedule = new Uint32Array(64);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bitLengthLo = (input.length * 8) >>> 0;
  const bitLengthHi = Math.floor(input.length / 0x20000000);
  for (let block = 0; block < paddedLength; block += 64) {
    if (block + 64 <= input.length) {
      // A block wholly inside the input: four direct byte reads per word.
      for (let i = 0, pos = block; i < 16; i++, pos += 4) {
        const b0 = input[pos],
          b1 = input[pos + 1],
          b2 = input[pos + 2],
          b3 = input[pos + 3];
        if (
          b0 === undefined ||
          b1 === undefined ||
          b2 === undefined ||
          b3 === undefined
        )
          throw "SHA-256 input view changed during hashing";
        schedule[i] = b0 * 16777216 + b1 * 65536 + b2 * 256 + b3;
      }
      compressSha256(state, schedule);
      continue;
    }
    for (let i = 0; i < 16; i++) {
      let word = 0;
      for (let j = 0; j < 4; j++) {
        const pos = block + i * 4 + j;
        let byte = 0;
        if (pos < input.length) {
          const value = input[pos];
          if (value === undefined)
            throw "SHA-256 input view changed during hashing";
          byte = value;
        } else if (pos === input.length) byte = 0x80;
        else if (pos >= paddedLength - 8) {
          const n = pos - (paddedLength - 8);
          byte =
            n < 4
              ? (bitLengthHi >>> ((3 - n) * 8)) & 255
              : (bitLengthLo >>> ((7 - n) * 8)) & 255;
        }
        word = word * 256 + byte;
      }
      schedule[i] = word;
    }
    compressSha256(state, schedule);
  }
  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 4; j++)
      digest[i * 4 + j] = (word(state, i) >>> ((3 - j) * 8)) & 255;
  return digest;
}
