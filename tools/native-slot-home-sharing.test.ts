// Slot register homes are shared between slots whose live ranges never meet
// at instruction grain, so functions with many more live integers, numbers,
// booleans and references than callee-saved registers keep more of them in
// registers. Every phase below writes a fresh set of slots while values from
// earlier phases (accumulators, references, slots live into a handler) must
// survive: a home shared with an interfering slot corrupts the checksum.
// Phases sit in loops with and without calls, allocations (safepoints) and
// throws into handlers. The same source runs in Node for the expected
// checksum and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `function opaque(value: number, depth: number): number {
  // Recursive, so never inlined: a real call inside the loops below.
  if (depth <= 0) return (value * 7 + 3) % 65521;
  return opaque(value + depth, depth - 1);
}
function fails(value: number): number {
  if (value % 5 === 3) throw "odd " + value;
  return value + 1;
}
// Integer phases inside one loop body: each phase's slots die before the
// next phase writes its own, while total and carry stay live throughout.
function integers(n: number): number {
  let total = 0,
    carry = 1;
  for (let i = 0; i < n; i++) {
    let a0 = i, a1 = i + 1, a2 = i * 2, a3 = i ^ 5, a4 = i & 7, a5 = i * 3,
      a6 = i % 11, a7 = i >> 1, a8 = i + 9;
    for (let k = 0; k < 3; k++) {
      a0 = (a0 + a1) & 65535; a1 = a1 ^ a2; a2 = (a2 + a3) & 65535;
      a3 = (a3 * 3 + a4) & 65535; a4 = a4 + (a5 & 3); a5 = a5 ^ a6;
      a6 = (a6 + a7) & 65535; a7 = (a7 + a8) & 1023; a8 = (a8 + a0) & 4095;
    }
    const sumA = (a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8) & 1048575;
    let b0 = sumA & 255, b1 = sumA >> 3, b2 = carry, b3 = i * 5, b4 = sumA ^ i,
      b5 = 17, b6 = i & 3, b7 = sumA % 97, b8 = carry ^ 9;
    for (let k = 0; k < 4; k++) {
      b0 = (b0 * 5 + b1) & 65535; b1 = (b1 + b2) & 65535; b2 = b2 ^ b3;
      b3 = (b3 + b4) & 65535; b4 = (b4 + b5 * k) & 65535; b5 = b5 ^ b6;
      b6 = (b6 + b7) & 255; b7 = (b7 + b8) & 4095; b8 = (b8 * 3 + b0) & 65535;
      if ((b0 & 1) === 1) carry = (carry + b8) & 65535;
    }
    const sumB = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8) & 1048575;
    total = (total * 31 + sumA * 7 + sumB + carry) % 1000003;
  }
  return total;
}
// The same shape with a call in every inner iteration: callee-saved homes
// survive the call, and phase values stay live across it.
function integersWithCalls(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    let c0 = i, c1 = i + 2, c2 = i * 3, c3 = 7, c4 = i & 15, c5 = i ^ 3,
      c6 = 11, c7 = i % 13, c8 = 1;
    for (let k = 0; k < 2; k++) {
      c0 = (c0 + opaque(c1 + k, 2)) & 65535; c1 = (c1 + c2) & 65535;
      c2 = c2 ^ c3; c3 = (c3 + c4) & 255; c4 = (c4 * 3 + c5) & 4095;
      c5 = (c5 + opaque(c6, 1)) & 65535; c6 = (c6 + c7) & 1023;
      c7 = c7 ^ c8; c8 = (c8 + c0) & 65535;
    }
    const sumC = (c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8) & 1048575;
    let d0 = sumC, d1 = sumC >> 2, d2 = i, d3 = 5, d4 = sumC & 31, d5 = 2,
      d6 = i + 4, d7 = 3, d8 = sumC % 89;
    for (let k = 0; k < 2; k++) {
      d0 = (d0 + d1) & 65535; d1 = (d1 ^ d2) + opaque(d3, k); d2 = (d2 + d3) & 255;
      d3 = (d3 * 7 + d4) & 4095; d4 = d4 + d5; d5 = d5 ^ d6;
      d6 = (d6 + d7) & 1023; d7 = (d7 + d8) & 255; d8 = (d8 + d0) & 65535;
    }
    const sumD = (d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8) & 1048575;
    total = (total * 29 + sumC + sumD * 3) % 1000003;
  }
  return total;
}
// Doubles: more than eight live numbers per phase, d8..d15 shared across
// phases; the running sum stays live across all of them.
function doubles(n: number): number {
  let sum = 0.5;
  for (let i = 0; i < n; i++) {
    let x0 = i * 0.5, x1 = i / 3, x2 = Math.sqrt(i + 1), x3 = i * 1.25,
      x4 = 0.75, x5 = i / 7, x6 = 1.5, x7 = i * 0.125, x8 = 2.5, x9 = i / 9;
    for (let k = 0; k < 3; k++) {
      x0 = x0 * 0.5 + x1; x1 = x1 + x2 * 0.25; x2 = x2 * 0.75 + x3;
      x3 = x3 * 0.5 + x4; x4 = x4 + x5; x5 = x5 * 0.5 + x6;
      x6 = x6 + x7 * 0.5; x7 = x7 * 0.25 + x8; x8 = x8 * 0.5 + x9;
      x9 = x9 + x0 * 0.125;
    }
    const first = x0 + x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9;
    let y0 = first, y1 = first / 2, y2 = sum * 0.001, y3 = 3.5, y4 = first / 5,
      y5 = 0.25, y6 = i + 0.5, y7 = first * 0.125, y8 = 1.75, y9 = i / 11;
    for (let k = 0; k < 2; k++) {
      y0 = y0 * 0.5 + y1; y1 = y1 * 0.5 + y2; y2 = y2 + y3 * 0.25;
      y3 = y3 * 0.5 + y4; y4 = y4 * 0.75 + y5; y5 = y5 + y6 * 0.125;
      y6 = y6 * 0.5 + y7; y7 = y7 * 0.25 + y8; y8 = y8 + y9; y9 = y9 * 0.5 + y0;
    }
    const second = y0 + y1 + y2 + y3 + y4 + y5 + y6 + y7 + y8 + y9;
    sum = (sum + first * 0.001 + second * 0.0001) % 1000;
  }
  return Math.floor(sum * 1000000) % 1000003;
}
// Booleans and integers together in the GP homes.
function flags(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    let p0 = (i & 1) === 1, p1 = (i & 2) === 2, p2 = i % 3 === 0,
      p3 = i % 5 === 0, p4 = i > 10, p5 = (i & 4) === 4, p6 = i % 7 === 2,
      p7 = (i ^ 6) > 4, p8 = i < 30;
    for (let k = 0; k < 3; k++) {
      p0 = p0 !== p1; p1 = p1 || (p2 && k === 1); p2 = !p3; p3 = p3 !== p4;
      p4 = p4 && p5; p5 = p5 || p6; p6 = p6 !== p7; p7 = !p8; p8 = p8 !== p0;
    }
    let bits = 0;
    if (p0) bits |= 1; if (p1) bits |= 2; if (p2) bits |= 4; if (p3) bits |= 8;
    if (p4) bits |= 16; if (p5) bits |= 32; if (p6) bits |= 64;
    if (p7) bits |= 128; if (p8) bits |= 256;
    let q0 = bits > 100, q1 = (bits & 3) === 1, q2 = i > 20, q3 = bits % 3 === 1,
      q4 = (bits & 8) === 0, q5 = total % 2 === 0, q6 = i % 4 === 1,
      q7 = bits < 50, q8 = (bits & 64) !== 0;
    for (let k = 0; k < 2; k++) {
      q0 = q0 !== q8; q1 = q1 && !q2; q2 = q2 || q3; q3 = q3 !== q4;
      q4 = !q5; q5 = q5 !== q6; q6 = q6 || q7; q7 = q7 && q0; q8 = !q1;
    }
    let more = 0;
    if (q0) more += 1; if (q1) more += 3; if (q2) more += 5; if (q3) more += 7;
    if (q4) more += 11; if (q5) more += 13; if (q6) more += 17;
    if (q7) more += 19; if (q8) more += 23;
    total = (total * 37 + bits * 101 + more) % 1000003;
  }
  return total;
}
// References live across allocating phases (safepoints) next to integers.
function references(n: number): number {
  let total = 0;
  const kept: number[] = [];
  for (let i = 0; i < n; i++) {
    let s0 = "a" + i, s1 = "bb" + (i * 2), s2 = "c" + (i & 7), r0 = i, r1 = i * 2,
      r2 = i ^ 7, r3 = 4, r4 = i % 9, r5 = 6, r6 = i & 1;
    const list: number[] = [];
    for (let k = 0; k < 3; k++) {
      list.push(r0 + s0.length);
      s0 = s0 + k; s1 = s1 + s2; r0 = (r0 + r1) & 65535; r1 = r1 ^ r2;
      r2 = (r2 + r3) & 4095; r3 = r3 + r4; r4 = (r4 + r5) & 255;
      r5 = r5 ^ r6; r6 = (r6 + r0) & 1023;
    }
    const first = s0.length * 7 + s1.length + list.length +
      ((r0 + r1 + r2 + r3 + r4 + r5 + r6) & 65535);
    let t0 = s1, t1 = "x" + first, u0 = first, u1 = first >> 1, u2 = 3,
      u3 = i, u4 = first & 15, u5 = 8, u6 = 2, u7 = i + 5;
    for (let k = 0; k < 2; k++) {
      t0 = t0 + t1.length; t1 = t1 + "y"; u0 = (u0 + u1) & 65535;
      u1 = u1 ^ u2; u2 = (u2 + u3) & 255; u3 = (u3 + u4) & 4095;
      u4 = u4 + u5; u5 = u5 ^ u6; u6 = (u6 + u7) & 1023; u7 = (u7 + u0) & 255;
      kept.push(t1.length);
    }
    const second = t0.length + t1.length +
      ((u0 + u1 + u2 + u3 + u4 + u5 + u6 + u7) & 65535);
    total = (total * 41 + first * 3 + second + kept.length) % 1000003;
  }
  return total;
}
// Values live into a handler stay live throughout the protected code: a
// throw mid-phase must find them intact even though later phases write slots.
function exceptions(n: number): number {
  let total = 0,
    caught = 0;
  for (let i = 0; i < n; i++) {
    let h0 = i, h1 = i * 2, h2 = i ^ 3, h3 = 5, h4 = i & 7, h5 = i % 6,
      h6 = 9, h7 = i + 1, h8 = 2;
    try {
      for (let k = 0; k < 3; k++) {
        h0 = (h0 + h1) & 65535; h1 = h1 ^ h2; h2 = (h2 + h3) & 4095;
        h3 = (h3 + h4) & 255; h4 = h4 + h5; h5 = h5 ^ h6;
        h6 = (h6 + h7) & 1023; h7 = (h7 + h8) & 255;
        h8 = fails(h8 + k + i);
      }
      let g0 = h0 + 1, g1 = h1 + 2, g2 = h2 + 3, g3 = h3 + 4, g4 = h4 + 5,
        g5 = h5 + 6, g6 = h6 + 7, g7 = h7 + 8, g8 = h8 + 9;
      for (let k = 0; k < 2; k++) {
        g0 = (g0 + g1) & 65535; g1 = g1 ^ g2; g2 = (g2 + g3) & 4095;
        g3 = fails(g3 + g4); g4 = (g4 + g5) & 255; g5 = g5 ^ g6;
        g6 = (g6 + g7) & 1023; g7 = (g7 + g8) & 255; g8 = (g8 + g0) & 65535;
      }
      total = (total * 43 + g0 + g1 + g2 + g3 + g4 + g5 + g6 + g7 + g8) % 1000003;
    } catch (error) {
      caught++;
      total = (total * 47 + h0 + h1 * 3 + h2 * 5 + h3 * 7 + h4 * 11 + h5 * 13 +
        h6 * 17 + h7 * 19 + h8 * 23) % 1000003;
    }
  }
  return (total * 53 + caught) % 1000003;
}
export function checksum(): number {
  let total = integers(40);
  total = (total * 59 + integersWithCalls(30)) % 1000003;
  total = (total * 61 + doubles(40)) % 1000003;
  total = (total * 67 + flags(40)) % 1000003;
  total = (total * 71 + references(25)) % 1000003;
  total = (total * 73 + exceptions(30)) % 1000003;
  return total;
}
`;

test("slots sharing register homes keep every live value", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-slot-home-sharing-"));
  let expected: number;
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    expected = module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "slot-home-sharing",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
