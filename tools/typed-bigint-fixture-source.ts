// Typed BigInt semantics (docs/unified-pipeline.md, slice 4a). `run` returns
// 42 when every check holds, else the number of the first failing check.
// tools/build-typed-bigint-fixture.ts runs it natively on the typed path;
// tools/typed-bigint-fixture.test.ts runs the same source under Node.
export const typedBigIntSource = `// Message checks wait for instanceof narrowing of caught values (slice 4a).
function throwsRange(action: () => bigint): boolean {
  try {
    action();
  } catch (error) {
    return error instanceof RangeError;
  }
  return false;
}
function widen(high: number, low: number): bigint {
  return (BigInt(high) << 32n) | BigInt(low);
}
function half(value: bigint, high: boolean): number {
  return Number(high ? value >> 32n : value & 0xffffffffn);
}
function first(values: (bigint | undefined)[]): bigint | undefined {
  return values[0];
}
// BigInts in general values: typeof, narrowing and checked downcasts.
function describe(value: unknown): string {
  if (typeof value === "bigint") return "big:" + String(value + 1n);
  return typeof value;
}
function toBig(value: unknown): bigint {
  return value as bigint;
}
function downcastFails(value: unknown): boolean {
  try {
    toBig(value);
  } catch (error) {
    return error instanceof TypeError;
  }
  return false;
}
export function run(): number {
  const big = 18446744073709551615n;
  const one = 1n;
  if (big + one !== 18446744073709551616n) return 1;
  if (big - big !== 0n) return 2;
  if (12345678901234567890n * 98765432109876543210n !==
      1219326311370217952237463801111263526900n) return 3;
  if (-7n / 2n !== -3n || 7n / -2n !== -3n) return 4;
  if (-7n % 2n !== -1n || 7n % -2n !== 1n) return 5;
  if (2n ** 100n !== 1267650600228229401496703205376n) return 6;
  if ((-5n >> 1n) !== -3n || (5n << -1n) !== 2n) return 7;
  if ((-1n & 0xffn) !== 255n || (6n | 9n) !== 15n || (6n ^ 3n) !== 5n)
    return 8;
  if (~0n !== -1n || -(-3n) !== 3n || -0n !== 0n) return 9;
  // Comparisons, also against Numbers, are exact.
  if (!(1n < 2n) || 2n <= 1n || !(3n >= 3n) || 4n > 4n) return 10;
  if (!(9007199254740993n > 9007199254740992) ||
      9007199254740993n <= 9007199254740992) return 11;
  if (!(1.5 < 2n) || !(2n > 1.5) || 3 < 2n || !(-1 <= -1n)) return 12;
  if (1n < NaN || 1n >= NaN || NaN > 1n) return 13;
  // Equality compares values, never identities.
  const a = widen(1, 2),
    b = widen(1, 2);
  if (!(a === b) || a !== b || a === widen(1, 3)) return 14;
  if (typeof a !== "bigint") return 15;
  if (half(a, true) !== 1 || half(a, false) !== 2) return 16;
  if (Number(2n ** 64n) !== 18446744073709551616) return 17;
  if (Number(9007199254740993n) !== 9007199254740992) return 18;
  if (BigInt(-42) !== -42n || BigInt(true) !== 1n || BigInt(false) !== 0n)
    return 19;
  // Truthiness: only 0n is falsy.
  if (!!0n || !1n || !-1n) return 20;
  let counted = 0;
  for (let n = 3n; n; n = n - 1n) counted++;
  if (counted !== 3) return 21;
  // String conversion.
  if (String(-123n) !== "-123" || "x" + 10n !== "x10" || 10n + "y" !== "10y")
    return 22;
  if (\`\${big}\` !== "18446744073709551615") return 23;
  // RangeErrors.
  if (!throwsRange(() => 1n / 0n)) return 24;
  if (!throwsRange(() => 1n % 0n)) return 25;
  if (!throwsRange(() => 2n ** -1n)) return 26;
  if (!throwsRange(() => BigInt(1.5))) return 27;
  if (!throwsRange(() => 1n << 2000000000n)) return 28;
  // A possibly absent BigInt.
  const present = first([5n]),
    absent = first([]);
  if (present === undefined || absent !== undefined) return 29;
  if (typeof present !== "bigint" || typeof absent !== "undefined") return 30;
  if (!present || !!absent) return 31;
  const zero = first([0n]);
  if (zero === undefined || !!zero) return 32;
  const general: unknown = 41n;
  if (typeof general !== "bigint" || describe(general) !== "big:42") return 33;
  if (describe(5) !== "number" || describe({ x: 1 }) !== "object") return 34;
  if (toBig(general) + 1n !== 42n) return 35;
  if (downcastFails(7n)) return 36;
  const mixed: unknown[] = [1n, 2, "3"];
  let bigints = 0;
  for (const item of mixed) if (typeof item === "bigint") bigints++;
  if (bigints !== 1) return 37;
  return 42;
}
`;

// Native only: Tint checks `x as T` from unknown and throws a TypeError on a
// mismatch, where JavaScript erases the assertion (so Node cannot serve as
// the reference here).
export const typedBigIntDowncastSource = `function toBig(value: unknown): bigint {
  return value as bigint;
}
function downcastFails(value: unknown): boolean {
  try {
    toBig(value);
  } catch (error) {
    return error instanceof TypeError;
  }
  return false;
}
export function run(): number {
  if (!downcastFails("41")) return 1;
  if (!downcastFails(41)) return 2;
  if (!downcastFails({ value: 41 })) return 3;
  if (downcastFails(41n)) return 4;
  return 42;
}
`;
