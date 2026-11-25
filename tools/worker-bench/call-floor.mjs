// Diagnostic: per-iteration cost of untyped loops that call a builtin, to
// separate the general call path from the Atomics runtime (not a benchmark
// set; run under Node with `node call-floor.mjs` or natively).
const iterations = 1000000;
function time(name, body, now) {
  const start = now();
  const result = body();
  const elapsed = now() - start;
  console.log(
    "CALL_FLOOR " +
      JSON.stringify({ name, ns: (elapsed * 1e6) / iterations, result }),
  );
}
export function run(now) {
  const words = new Int32Array(new SharedArrayBuffer(64));
  const plain = new Int32Array(16);
  for (let round = 0; round < 2; round++) {
    time(
      "empty loop",
      () => {
        let sum = 0;
        for (let i = 0; i < iterations; i++) sum += i & 1;
        return sum;
      },
      now,
    );
    time(
      "Math.abs",
      () => {
        let sum = 0;
        for (let i = 0; i < iterations; i++) sum += Math.abs(-i);
        return sum;
      },
      now,
    );
    time(
      "plain element ++",
      () => {
        for (let i = 0; i < iterations; i++) plain[0]++;
        return plain[0];
      },
      now,
    );
    time(
      "Atomics.load",
      () => {
        let sum = 0;
        for (let i = 0; i < iterations; i++) sum += Atomics.load(words, 0);
        return sum;
      },
      now,
    );
    time(
      "Atomics.add",
      () => {
        for (let i = 0; i < iterations; i++) Atomics.add(words, 0, 1);
        return Atomics.load(words, 0);
      },
      now,
    );
  }
  return 42;
}
