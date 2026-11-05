// SHA-256 constants and round structure: FIPS 180-4 sections 4.2.2, 5 and 6.2.
const K: Uint32Array = createConstants();
function createConstants(): Uint32Array {
  const values = new Uint32Array(64);
  values[0] = 0x428a2f98;
  values[1] = 0x71374491;
  values[2] = 0xb5c0fbcf;
  values[3] = 0xe9b5dba5;
  values[4] = 0x3956c25b;
  values[5] = 0x59f111f1;
  values[6] = 0x923f82a4;
  values[7] = 0xab1c5ed5;
  values[8] = 0xd807aa98;
  values[9] = 0x12835b01;
  values[10] = 0x243185be;
  values[11] = 0x550c7dc3;
  values[12] = 0x72be5d74;
  values[13] = 0x80deb1fe;
  values[14] = 0x9bdc06a7;
  values[15] = 0xc19bf174;
  values[16] = 0xe49b69c1;
  values[17] = 0xefbe4786;
  values[18] = 0x0fc19dc6;
  values[19] = 0x240ca1cc;
  values[20] = 0x2de92c6f;
  values[21] = 0x4a7484aa;
  values[22] = 0x5cb0a9dc;
  values[23] = 0x76f988da;
  values[24] = 0x983e5152;
  values[25] = 0xa831c66d;
  values[26] = 0xb00327c8;
  values[27] = 0xbf597fc7;
  values[28] = 0xc6e00bf3;
  values[29] = 0xd5a79147;
  values[30] = 0x06ca6351;
  values[31] = 0x14292967;
  values[32] = 0x27b70a85;
  values[33] = 0x2e1b2138;
  values[34] = 0x4d2c6dfc;
  values[35] = 0x53380d13;
  values[36] = 0x650a7354;
  values[37] = 0x766a0abb;
  values[38] = 0x81c2c92e;
  values[39] = 0x92722c85;
  values[40] = 0xa2bfe8a1;
  values[41] = 0xa81a664b;
  values[42] = 0xc24b8b70;
  values[43] = 0xc76c51a3;
  values[44] = 0xd192e819;
  values[45] = 0xd6990624;
  values[46] = 0xf40e3585;
  values[47] = 0x106aa070;
  values[48] = 0x19a4c116;
  values[49] = 0x1e376c08;
  values[50] = 0x2748774c;
  values[51] = 0x34b0bcb5;
  values[52] = 0x391c0cb3;
  values[53] = 0x4ed8aa4a;
  values[54] = 0x5b9cca4f;
  values[55] = 0x682e6ff3;
  values[56] = 0x748f82ee;
  values[57] = 0x78a5636f;
  values[58] = 0x84c87814;
  values[59] = 0x8cc70208;
  values[60] = 0x90befffa;
  values[61] = 0xa4506ceb;
  values[62] = 0xbef9a3f7;
  values[63] = 0xc67178f2;
  return values;
}
export function readSha256Word(words: Uint32Array, index: number): number {
  const value = words[index];
  if (value === undefined) throw "SHA-256 internal index invariant";
  return value;
}
function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
/** Compress one block. The first 16 schedule words contain big-endian input;
 * state (8 words) and scratch (64 words) must be separate caller-owned views.
 * No per-block allocation; scratch is overwritten and state updated in place. */
export function compressSha256(
  state: Uint32Array,
  schedule: Uint32Array,
): void {
  if (state.length < 8 || schedule.length < 64)
    throw "SHA-256 workspace too short";
  compressWords(state, schedule, K);
}
function compressWords(
  state: Uint32Array,
  schedule: Uint32Array,
  constants: Uint32Array,
): void {
  for (let i = 16; i < 64; i++) {
    const x = readSha256Word(schedule, i - 15),
      y = readSha256Word(schedule, i - 2);
    const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
    const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
    schedule[i] =
      (readSha256Word(schedule, i - 16) +
        s0 +
        readSha256Word(schedule, i - 7) +
        s1) >>>
      0;
  }
  let a = readSha256Word(state, 0),
    b = readSha256Word(state, 1),
    c = readSha256Word(state, 2),
    d = readSha256Word(state, 3);
  let e = readSha256Word(state, 4),
    f = readSha256Word(state, 5),
    g = readSha256Word(state, 6),
    h = readSha256Word(state, 7);
  for (let i = 0; i < 64; i++) {
    const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choose = (e & f) ^ (~e & g);
    const t1 =
      (h +
        s1 +
        choose +
        readSha256Word(constants, i) +
        readSha256Word(schedule, i)) >>>
      0;
    const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  state[0] = (readSha256Word(state, 0) + a) >>> 0;
  state[1] = (readSha256Word(state, 1) + b) >>> 0;
  state[2] = (readSha256Word(state, 2) + c) >>> 0;
  state[3] = (readSha256Word(state, 3) + d) >>> 0;
  state[4] = (readSha256Word(state, 4) + e) >>> 0;
  state[5] = (readSha256Word(state, 5) + f) >>> 0;
  state[6] = (readSha256Word(state, 6) + g) >>> 0;
  state[7] = (readSha256Word(state, 7) + h) >>> 0;
}
