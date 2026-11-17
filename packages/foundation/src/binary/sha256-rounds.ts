// SHA-256 rounds: FIPS 180-4 sections 4.1.2, 6.2.2.
function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
// Native builds bind two of these functions to host operations, so this
// module stays a state-free declared runtime and each function keeps its
// exact signature and observable effect.
/** Whether compressSha256RoundsWithInstructions may run: native builds bind
 * this to the `cpu-sha256` host operation (1 when the CPU implements the
 * ARMv8 SHA-256 instructions, else 0). Elsewhere the portable rounds run. */
export function sha256InstructionsAvailable(): number {
  return 0;
}
/** compressSha256RoundsPortable's effect, which native builds bind to the
 * `sha256-rounds` host operation (the ARMv8 SHA-256 instructions, which
 * trap on short views instead). Call it only when
 * sha256InstructionsAvailable() is 1. */
export function compressSha256RoundsWithInstructions(
  state: Uint32Array,
  schedule: Uint32Array,
  constants: Uint32Array,
): void {
  compressSha256RoundsPortable(state, schedule, constants);
}
/** The block rounds: expands schedule words 16-63 from the first 16, then
 * compresses with `constants` and adds the result into state. Callers check
 * the workspace lengths (8, 64 and 64 words); out-of-range reads see 0. */
export function compressSha256RoundsPortable(
  state: Uint32Array,
  schedule: Uint32Array,
  constants: Uint32Array,
): void {
  for (let i = 16; i < 64; i++) {
    const x = schedule[i - 15] ?? 0,
      y = schedule[i - 2] ?? 0;
    const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
    const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
    schedule[i] =
      ((schedule[i - 16] ?? 0) + s0 + (schedule[i - 7] ?? 0) + s1) >>> 0;
  }
  let a = state[0] ?? 0,
    b = state[1] ?? 0,
    c = state[2] ?? 0,
    d = state[3] ?? 0;
  let e = state[4] ?? 0,
    f = state[5] ?? 0,
    g = state[6] ?? 0,
    h = state[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choose = (e & f) ^ (~e & g);
    const t1 =
      (h + s1 + choose + (constants[i] ?? 0) + (schedule[i] ?? 0)) >>> 0;
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
  state[0] = ((state[0] ?? 0) + a) >>> 0;
  state[1] = ((state[1] ?? 0) + b) >>> 0;
  state[2] = ((state[2] ?? 0) + c) >>> 0;
  state[3] = ((state[3] ?? 0) + d) >>> 0;
  state[4] = ((state[4] ?? 0) + e) >>> 0;
  state[5] = ((state[5] ?? 0) + f) >>> 0;
  state[6] = ((state[6] ?? 0) + g) >>> 0;
  state[7] = ((state[7] ?? 0) + h) >>> 0;
}
