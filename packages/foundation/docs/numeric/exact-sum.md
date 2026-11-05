# @tint/foundation/numeric/exact-sum

Streaming, order-independent binary64 summation. `createExactSum` creates mutable
state, `addExactSum` consumes a Number, and `finishExactSum` rounds once to the
nearest binary64 value with ties to even. Reading the result does not consume or
modify the accumulator.

Finite values are accumulated as arbitrary-precision integers in units of the
smallest binary64 subnormal. Cancellation therefore recovers values even after a
partial sum would overflow ordinary floating-point arithmetic. Integer storage and
IEEE decomposition reuse `@tint/foundation/numeric/big-integer` and `@tint/foundation/binary/bytes`.

NaN, opposing infinities and signed zero follow
[ECMAScript Math.sumPrecise](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.sumprecise): empty input and
all-negative-zero input produce -0, while finite cancellation produces +0. Input
validation, iterator closing and item-count limits belong to the caller; this
package performs no coercion, iteration, host calls or runtime-object operations.
