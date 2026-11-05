# Math runtime

Live Math intrinsics apply observable ToNumber coercions before calling portable
numeric algorithms. Conversion order, abrupt completion and signed-zero behavior
belong to the intrinsic adapter; algorithms do not depend on the object model.

## Current algorithms

- `hypot` scales by the largest magnitude and compensates the sum of squares.
  All arguments are converted even after NaN or Infinity appears.
- `fround` and `f16round` reuse the byte codec's direct round-to-nearest-even
  conversion. Binary16 is rounded directly from binary64, avoiding double rounding.
- `sumPrecise` consumes the iterator without numeric coercion and closes it when
  rejecting a non-Number value. `@tint/foundation/numeric/exact-sum` accumulates integer multiples of
  the smallest binary64 subnormal, then rounds once. It preserves cancellation
  across intermediate overflow and the specified empty/all-negative-zero result.
- `cbrt` reduces by exact powers of eight before bounded Newton iteration, so
  intermediate arithmetic cannot overflow or underflow.
- `log`, `log2`, `log10` and `log1p` share power-of-two reduction and a compensated
  atanh series. Split ln(2) reduces exponent-product error; log1p corrects the low
  part lost in `1+x`. These are implementation-approximated operations, not a claim
  of universally correctly rounded transcendental results.

- `exp` reduces by split ln(2), evaluates a compensated series, then scales by
  powers of two. Subnormal results round only at the final scaling operation.
  `expm1` evaluates small inputs directly to avoid cancellation.

The first three bullets have completed native Test262 selections in the
[dashboard](test262.md). Cube roots, exponentials and logarithms pass twelve native regression cases.
The complete cbrt selection passes 10/10. Tests cover the
binary64 exponent range, exact binary logarithms, subnormals and coercion failures.
The exact sum also has an independent rational-arithmetic reference comparison.

The six hyperbolic functions reuse expm1/log1p, with separate large-magnitude
formulas to avoid cancellation and premature overflow. Portable boundary tests
and all four native regression cases pass.

Atan/atan2 and inverse sine/cosine now have bounded-series implementations and
portable domain/quadrant tests; all three native regression cases pass.
Binary intrinsic adapters share ordered coercion before invoking their algorithms.

`@tint/foundation/numeric/binary64-trigonometry` now implements sine/cosine/tangent with exact
fixed-point quadrant reduction and compensated bounded series. Portable tests
span every binary exponent; the 2304-bit reduction constant was independently
verified. All three native regression cases pass.

Positive finite fractional powers now reuse log/exp, with a direct square-root path.
Portable tests cover special cases and 12,000 deterministic inputs; all three native regression cases pass. This is implementation-approximated, not universally correctly rounded.
Both the live exponentiation operator and Math.pow use the same implementation.

Math.random now accepts an explicit host capability. The native host supplies
independent OS entropy draws through `@tint/native-runtime/intrinsics/random`, forming uniform 53-bit
values in [0,1); hosts without a capability report unsupported execution. The
Darwin entropy symbol is isolated in the target ABI. Both native regression cases
and all 10 Math.random Test262 variants pass.

Complete selection results belong in the [dashboard](test262.md); focused
regressions do not replace full-family totals. Ordinary scalar lowering remains a
separate surface: installing a live intrinsic does not add a strict compiler
intrinsic automatically.

Semantics follow [ECMAScript Math](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math-object).

## Number formatting

Number.prototype.toFixed, toExponential and toPrecision reuse `@tint/foundation/numeric/number-text`'s
exact binary64-to-decimal expansion. Presentation rounding is separate from
shortest round-trip selection, preserving requested trailing zeros and the
specified tie rule. The object adapter owns receiver validation, observable
precision coercion and method-specific RangeError ordering. The non-Intl
`toLocaleString` fallback returns decimal text, as with BigInt; ECMA-402 remains
separate. Portable tests, four native precision-formatting cases and two non-Intl locale
cases pass. Complete Test262 selections are queued.
