# Arbitrary-precision integers

Portable signed integer arithmetic built from exact number operations, with no
JavaScript BigInt or host-library dependency. The same implementation runs under
Node and through Tint's native compiler.

Values use immutable, little-endian base-2^26 digits and a separate sign. Every
public operation returns a canonical value: no leading zero digits and no negative
zero. Consumers must use these constructors and operations rather than fabricate
`Integer` records. Arithmetic does not mutate its operands.

- `parseInteger` / `formatInteger`: radices 2–36; invalid input or radix returns
  undefined. Text accepts an optional sign, but no whitespace, prefix, separator
  or suffix. Language-specific grammar belongs in the adapter.
- `add`, `subtract`, `multiply`, `negate`, `compare`: exact signed arithmetic.
- `divide`: quotient truncates toward zero; remainder follows the dividend's
  sign. Division by zero returns undefined.
- `bitwise` / `bitwiseNot`: infinite two's-complement sign-extension semantics.
- `truncateInteger`: retain a specified number of low bits with signed or unsigned
  interpretation. Accepts safe-integer bit counts and an explicit scratch digit
  limit; unchanged small values do not allocate proportional to the bit count.
- `shift` / `power`: signed shifts and nonnegative exponentiation with an explicit
  caller-provided result digit limit. Invalid arguments or oversized results return
  undefined; huge counts still work when the result is zero or a unit integer.
- `fromNumber` / `toNumber`: exact finite integral input conversion and binary64
  output rounding to nearest, ties to even. Nonintegral inputs return undefined.
- `divideToNumber`: a binary64 quotient rounded once, including subnormals and
  overflow. Zero divisors return undefined; input integers are not rounded first.
- `compareNumber`: exact mixed comparison, including fractional numbers and
  infinities; NaN returns undefined.

A digit product plus carry and accumulator fits exactly below 2^53. Single-digit
division supports radix formatting; multi-digit division currently uses binary
long division. Faster algorithms can replace these internals without changing
value or rounding semantics.

The ordinary-object runtime adapter provides Script BigInt grammar, coercions,
errors and intrinsics. This package stays independent of those language policies.

Tests compare exact results against Node BigInt, including deterministic generated
operands. `tools/verify-hosted-big-integer.ts` checks large arithmetic and radix
conversions in native output.
