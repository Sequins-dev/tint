// SHA-256 constants and round structure: FIPS 180-4 sections 4.2.2, 5 and 6.2.
import {
  compressSha256RoundsPortable,
  compressSha256RoundsWithInstructions,
  sha256InstructionsAvailable,
} from "./sha256-rounds.ts";
const K: Uint32Array = createConstants();
/** CPUs without the SHA-256 instructions (possible on Linux) take the
 * portable rounds. */
const instructions = sha256InstructionsAvailable() === 1;
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
/** Compress one block. The first 16 schedule words contain big-endian input;
 * state (8 words) and scratch (64 words) must be separate caller-owned views.
 * No per-block allocation; scratch is overwritten and state updated in place. */
export function compressSha256(
  state: Uint32Array,
  schedule: Uint32Array,
): void {
  if (state.length < 8 || schedule.length < 64)
    throw "SHA-256 workspace too short";
  if (instructions) compressSha256RoundsWithInstructions(state, schedule, K);
  else compressSha256RoundsPortable(state, schedule, K);
}
