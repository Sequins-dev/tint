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
