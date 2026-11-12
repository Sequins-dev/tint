// Unchecked typed-array accesses (ir/optimization/bounds.ts) are selected
// only where interval facts prove the index in bounds; reads and writes at
// and past the end keep their checks and JavaScript results (undefined,
// ignored writes), including in nested loops and with induction offsets.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `export function run(): number {
  const n = 8;
  const a = new Float64Array(n * n), b = new Uint8Array(n);
  for (let i = 0; i < n * n; i++) a[i] = i * 0.5;
  let inside = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) inside += a[i * n + j] ?? -1000;
  let edge = 0;
  for (let i = 0; i <= n * n; i++) edge += a[i] ?? -1;
  let shifted = 0;
  for (let i = 0; i < n * n; i++) shifted += a[i + 1] ?? -1;
  for (let i = 0; i <= n; i++) b[i] = i + 1;
  let bytes = 0;
  for (let i = 0; i < n + 2; i++) bytes += b[i] ?? 100;
  let negative = 0;
  for (let i = 0; i < 3; i++) negative += a[i - 1] ?? 7;
  const sieve = new Uint8Array(100);
  let primes = 0;
  for (let p = 2; p < 100; p++) {
    if (sieve[p] !== 0) continue;
    primes++;
    for (let m = p * p; m < 100; m += p) sieve[m] = 1;
  }
  return inside === 1008 && edge === 1007 && shifted === 1007 &&
    bytes === 236 && negative === 7 + 0 + 0.5 && primes === 25 ? 42 : 1;
}`,
  "array-bounds",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
