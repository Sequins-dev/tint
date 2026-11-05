# Numeric text conversion

`@tint/foundation/numeric/number-text` exports `stringToNumber(text: string): number` for the string
portion of ECMAScript Number conversion. It accepts decimal fractions/exponents,
unsigned hexadecimal/binary/octal prefixes, signed Infinity and ECMAScript surrounding
whitespace. Empty/whitespace strings produce zero; malformed input produces NaN.
Numeric separators and BigInt suffixes are not accepted by Number(string); the compiler
removes source-literal separators before calling this function.

`parseIntegerText(text, radix)` and `parseFloatText(text)` implement the prefix
scanning portions of the global parsers. Integer parsing applies ToInt32 to its
numeric radix, accepts bases 2–36, and uses the same exact integer rounding.
Floating parsing keeps the longest valid decimal/Infinity prefix and delegates
rounding to `stringToNumber`. Callers supply strings and numeric radices; observable
ToString/ToNumber coercion belongs to the language adapter.

The implementation owns its arithmetic. Private base-2^16 integer limbs stored in
Uint32Array represent the exact numerator and denominator. Binary long division and a
remainder comparison round once to nearest, ties to even. Powers of two then produce
the binary64 result, preserving signed zero, subnormals and overflow. There is no use
of Number(string), parseFloat, BigInt, a native library parser or a C intermediary.

This is a correctness-first baseline. It allocates temporary integers during rounding;
long inputs may take quadratic work and substantial memory. Node reclaims these through
its collector; Tint's current region runtime traps on exhaustion. Resource budgeting
and faster conversion paths remain future work. The private integer routines do not
constitute a general public arbitrary-precision arithmetic API.

Portable differential tests compare grammar, boundary values, deterministic decimal
and radix inputs, and binary64 round trips with Node. Tint checks, lowers and emits
every function unchanged. Native construction tests exercise decimal ties, minimum
subnormals, the normal boundary, maximum finite values and hexadecimal rounding, with
exact allocation accounting and exhaustion runs using process-local trap handling.

The compiler's Number(string) intrinsic uses this implementation through the explicit
`numberFromString` module-entry binding. It is a normal compiled function call, with
no separate native parsing implementation. Other input kinds and object coercion
remain outside the current intrinsic contract.

`numberToString(value: number): string` supplies decimal Number formatting. Safe
integers use exact decimal digit extraction without arbitrary-precision workspaces
or round-trip parsing. Other finite values expand
the binary value exactly using the same private integer arithmetic, then search
in increasing significant-digit counts. Each candidate is checked by `stringToNumber`;
the nearest candidate is tried first, with even-last-digit tie breaking. Layout follows
ECMAScript fixed/scientific thresholds; signed zero formats as `"0"`.
The contract follows [Number::toString](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring).

This baseline favors verifiability over speed. Exact expansion and repeated candidate
parsing allocate substantially; native region exhaustion remains an explicit limit.
There is no host formatter, BigInt or native library formatting call. Portable tests
compare special cases, boundaries and 2,000 deterministic binary64 values with Node.
Native tests execute integers, fractions, negative values and shortest conversion of
0.1, with exact allocation accounting and exhaustion checks. Other radices are not
part of this API.

The integer path covers both signs through 9,007,199,254,740,991. Differential tests
exercise powers of ten and the safe-integer boundary; a deterministic allocation
regression prevents these common compiler IDs from returning to the expensive
floating-point path. Native fixtures verify the largest safe integer and its exact
string allocation budget.

`numberToFixed(value, fraction)`, `numberToExponential(value, fraction)` and
`numberToPrecision(value, precision)` reuse the exact decimal expansion. They
round the represented binary value at the requested decimal position, breaking
presentation ties away from zero. Exponential and precision formatting accept
`undefined` for shortest output; supplied counts must already be validated by
the caller (0–100 fraction digits, 1–100 significant digits). Observable receiver
validation, coercion and RangeError ordering belong to the runtime adapter.
Unlike shortest conversion, these methods retain requested trailing zeros.
Portable tests cover boundary cases and 1,500 deterministic binary64 samples;
native regression and Test262 selections are queued.

Exact decimal quantities support the shared numerical machinery for Intl services.
`decimalFromString` parses decimal lexical input without converting the coefficient
to binary64; whitespace, radix conversion, coercion and Intl overflow/underflow
policy belong to callers. `decimalFromNumber` uses shortest decimal spelling and
preserves negative zero. Canonical quantities store sign, coefficient digits and a
power of ten separately; presentation zeroes are not part of mathematical identity.

`roundDecimal` rounds to an ECMA-402 increment times a decimal quantum using all
nine signed rounding modes. Exact remainder comparisons and quotient parity handle
ties, including increments such as 25 and 2500. Sparse exponents are classified
without expanding discarded zeroes. Unsafe exponent arithmetic is rejected.

`formatDecimalFraction` and `formatDecimalPrecision` return a rounded quantity,
signed plain decimal text with requested visible zeroes, and rounding magnitude.
They provide the numerical stages corresponding to
[ToRawFixed and ToRawPrecision](https://tc39.es/ecma402/#sec-torawprecision);
locale patterns, digit-option resolution and language-level coercions remain
separate. Plain output requires storage proportional to the resulting string.
`decimalToString` instead uses scientific notation for large/small magnitudes.

Exact integer-oracle tests cover every supported increment and rounding mode;
standard digit presentation is also compared with Node's Intl implementation.
`tools/verify-hosted-decimal.ts` exercises the same portable algorithms in a native
fixture. These checks are separate from public Intl Test262 conformance.
