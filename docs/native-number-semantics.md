# Native Number remainder and bitwise lowering

Implemented for the checked scalar Number subset. These are target-code helpers,
authored in TypeScript and encoded by the same AArch64 pipeline as other operations.
They are not foreign library calls, an interpreter or a second compiler.

Semantic references are ECMAScript's [ToInt32/ToUint32](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-touint32),
[Number remainder](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-remainder)
and [Number bitwise operations](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numberbitwiseop).
The operands here are already proven Numbers; general object/string coercion is
outside this scalar slice. These algorithms implement the existing numeric semantics,
not a change to the project's language conformance baseline.

## Conversion and bitwise operations

The private conversion kernel accepts raw binary64 bits in x9 and returns the low
32 bits of the truncated integer modulo 2^32 in w9. Let e be the unbiased exponent.

- Exponents below zero (including zero/subnormals) produce zero.
- NaN/infinity and e >= 84 produce zero. Finite values at e >= 84 are multiples of
  2^32 because their 53-bit significand's least significant bit has that weight.
- For 0 <= e < 52, restore the implicit leading significand bit and shift right by
  52 - e. Taking the low word then performs the modulo operation.
- For 52 <= e < 84, shift the low significand word left by e - 52. The implicit
  leading bit cannot contribute to the result's low 32 bits in this range.
- Negate the word modulo 2^32 when the original sign is negative.

This avoids a saturating floating-to-integer instruction for out-of-range inputs.
AND/OR/XOR/NOT operate on the resulting words. W-register variable shifts mask their
count to five bits; signed right shift and unsigned right shift remain distinct.
Signed results convert back with SCVTF; unsigned-right-shift results use UCVTF.
Every resulting 32-bit integer is exactly representable as a Number. Negative zero
converts to the ordinary integer zero, as required.

## Remainder

The private remainder kernel accepts d0/d1 and returns d0. It handles NaN, an infinite
dividend and a zero divisor as NaN. A finite dividend smaller in magnitude than the
divisor is returned unchanged, including either signed zero and infinite divisors.
The remaining calculation uses positive magnitudes and restores the dividend's sign.

Starting with the divisor, repeatedly double it until it exceeds half the dividend.
Then descend through those power-of-two scales, subtracting whenever the residual
is at least the scaled divisor. Stop after processing the original divisor. No
floating quotient or truncated-quotient multiplication is formed.

Scaling by powers of two is exact here and never needs to overflow. Each performed
subtraction has operands within a factor of two, so the difference is exact with
gradual underflow. After each step the residual is smaller than that scale. Descending
to the original divisor therefore leaves the required remainder without accumulated
rounding error. If halving a tiny dividend rounds up, scaling can overshoot it by
one step; the first subtraction is simply skipped. The original divisor's exact
power-of-two scaling path is still reversed. This also covers subnormal operands.

The algorithm has a bounded exponent-distance loop (roughly 2100 steps in each
direction for the widest binary64 ratio). It favors clear correctness over speed;
future optimization must retain the differential corpus. Negative exact multiples
produce -0. NaN payload bits are not a language-level result guarantee.

## Internal calling and linking contracts

Helpers are leaf instruction sequences with local labels, appended once per emitted
module when used. Source functions call them with BL; the usual source-function frame
already preserves x30. Helper offsets/lengths are reported separately from source
function metadata, and their bytes count against the emission budget.

ToUint32 clobbers x9–x12 and NZCV; x13 preserves the left operand across conversion
of the right operand. Remainder clobbers x9, d0–d5, NZCV and floating status flags.
Neither allocates, accesses the heap, calls other functions or raises a language
exception. They do not use the source-call completion/result header because they
are internal machine kernels with explicit clobber contracts. IEEE FPCR entry
requirements remain those of the scalar backend; no helper changes FPCR.

## Evidence and remaining scope

The native gate executes 445 generated executables twice. Its numeric corpus has
8,904 input/operator cases: an edge-value Cartesian product, exponent boundaries,
deterministic random binary64 values and quotient-overflow/rounding counterexamples.
Ordinary results and signed zero are compared exactly; NaN is compared by category.
Inputs travel through compiled function parameters. Native assertions are batched
into small functions to respect the initial frame limit. Each batch reports its
identity; `TINT_NATIVE_FILTER` can select fixtures for reproducing a failure.

The instruction oracle independently assembles/disassembles 891 encodings, including
boundary registers and bitfield immediates. Portable tests check helper sharing,
relative call linkage, output-budget accounting and deterministic emission.

All currently verified scalar IR operations now have native lowering. This does not
add exponentiation, general coercion, BigInt, compound/update syntax, strings, managed
objects or larger frames. General TypeScript coverage and self-hosting are still
future work.
