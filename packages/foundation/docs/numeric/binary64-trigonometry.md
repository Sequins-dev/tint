# @tint/foundation/numeric/binary64-trigonometry

Portable `sine`, `cosine` and `tangent` for binary64 Numbers. These functions
preserve specified exceptional values and signed zeros, with no object-model,
host math-library or locale dependencies. Results are implementation-approximated;
this is not a universal correctly-rounded claim.

Inputs outside the primary interval use integer fixed-point argument reduction.
The exact binary64 significand is multiplied by 2304 bits of 2/pi, retaining the
quadrant and a signed fraction before conversion back to floating point. Small
inputs avoid this reduction. Compensated bounded series evaluate the reduced
sine/cosine; tangent uses their quotient with the quadrant applied.

`tools/generate-trigonometry-constant.ts` derives the fixed-point constant using
Machin's identity with 4096-bit integer arithmetic. A separate Python Decimal
Chudnovsky calculation verified every emitted bit; evidence is in
`docs/results/trigonometry-constant-reference-v1.json`. No host approximation of pi
is used in the fixed-point constant. Its truncation contribution to the reduced
angle is below the binary64 subnormal range even for the largest finite input.

Tests span every binary exponent, include values adjacent to quadrant boundaries,
and compare with Node's math implementation using an explicit error tolerance.
The big-integer and byte-codec dependencies provide exact intermediate arithmetic
and binary64 decomposition; ECMAScript coercion belongs to the caller.
