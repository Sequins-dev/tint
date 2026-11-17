// node:zlib microbenchmark (docs/native-ffi.md, "zlib"): Tint's
// deflateSync/inflateSync over the system zlib, the same library driven
// directly from C (clang -O2, the FFI-free baseline) and Node's zlib (which
// bundles Chromium's zlib, a different implementation). Each loop times
// itself with the monotonic clock; the Tint image runs under LLDB (stopped
// at entry, exit status 42 asserted). Run under
//   lockf /Users/stephenbelanger/.t3/tint-timing.lock node tools/zlib-microbench.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
/** Input sizes and repetitions (about 0.3 s of deflate each). */
const cases: readonly (readonly [number, number])[] = [
  [1024, 20000],
  [65536, 600],
  [1048576, 40],
];
function text(bytes: number): string {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i++) {
    const line =
      "line " +
      String(i) +
      " " +
      String((i * 7919) % 1000) +
      " lorem ipsum dolor\n";
    out.push(line);
    length += line.length;
  }
  return out.join("").slice(0, bytes);
}
const textSource = `function text(bytes: number): string {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i++) {
    const line = "line " + String(i) + " " + String((i * 7919) % 1000) + " lorem ipsum dolor\\n";
    out.push(line);
    length += line.length;
  }
  return out.join("").slice(0, bytes);
}`;
function line(name: string, us: number, check: number): string {
  return name + " " + us.toFixed(2) + " us/op (checksum " + String(check) + ")";
}

// Tint.
const loops = cases
  .map(
    ([bytes, n]) => `{
  const input = ascii(text(${bytes}));
  const packed = deflateSync(input);
  let sum = 0;
  let start = monotonicMilliseconds();
  for (let i = 0; i < ${n}; i++) sum += deflateSync(input).length;
  let elapsed = monotonicMilliseconds() - start;
  console.log("tint deflateSync ${bytes} B " + String((elapsed * 1000) / ${n}) + " us/op (checksum " + String(sum) + ")");
  sum = 0;
  start = monotonicMilliseconds();
  for (let i = 0; i < ${n}; i++) sum += inflateSync(packed).length;
  elapsed = monotonicMilliseconds() - start;
  console.log("tint inflateSync ${bytes} B " + String((elapsed * 1000) / ${n}) + " us/op (checksum " + String(sum) + ")");
}`,
  )
  .join("\n");
const source = `import { monotonicMilliseconds } from "clock";
import { deflateSync, inflateSync } from "node:zlib";
${textSource}
function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  return bytes;
}
export function run(): number {
${loops}
  return 42;
}
`;
process.env.TINT_BUILD_ONLY = "1";
const image = verifyHostedFixture(
  source,
  "zlib-microbench",
  [
    ["clock", clock],
    ["node:zlib", "packages/native-runtime/src/node/zlib.ts"],
  ],
  [],
  [],
  [
    {
      module: clock,
      namespace: "bench-clock",
      retainedExports: ["monotonicMilliseconds"],
    },
  ],
  {
    managedBytes: 67108864,
    allocationCapacity: 4194304,
    hostBindings: [
      {
        module: clock,
        name: "monotonicMilliseconds",
        operation: "monotonic-time",
      },
    ],
  },
);
const native = spawnSync(
  "lldb",
  [
    "--no-lldbinit",
    "--batch",
    "-o",
    "process launch --stop-at-entry",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateStopped",
    "-o",
    "continue",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
    image,
  ],
  { encoding: "utf8", timeout: 900000 },
);
assert.equal(native.status, 0, native.stderr);
assert.match(native.stdout, /exited with status = 42 /, native.stdout);
console.log("image " + image);
console.log(
  native.stdout
    .split("\n")
    .filter((entry) => entry.includes("us/op"))
    .join("\n"),
);

// C over the same system zlib, with Node's chunked calling pattern.
const directory = mkdtempSync(join(tmpdir(), "tint-zlib-bench-"));
try {
  const c = join(directory, "bench.c");
  writeFileSync(
    c,
    String.raw`#include <zlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
static unsigned char out[16384];
static size_t run(int inflating, const unsigned char *in, size_t n, unsigned char *dst) {
  z_stream s; memset(&s, 0, sizeof s);
  if (inflating) inflateInit2(&s, 0); else deflateInit2(&s, -1, Z_DEFLATED, 15, 8, 0);
  s.next_in = (unsigned char *)in; s.avail_in = (uInt)n;
  size_t total = 0;
  for (;;) {
    s.next_out = out; s.avail_out = sizeof out;
    if (inflating) inflate(&s, Z_FINISH); else deflate(&s, Z_FINISH);
    size_t have = sizeof out - s.avail_out;
    memcpy(dst + total, out, have); total += have;
    if (s.avail_out != 0) break;
  }
  if (inflating) inflateEnd(&s); else deflateEnd(&s);
  return total;
}
static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e6 + t.tv_nsec / 1e3;
}
int main(int argc, char **argv) {
  size_t n = (size_t)atol(argv[1]); int reps = atoi(argv[2]);
  unsigned char *in = malloc(n), *packed = malloc(n + 1024), *back = malloc(n + 1024);
  if (fread(in, 1, n, stdin) != n) return 2;
  size_t packedLength = run(0, in, n, packed);
  size_t sum = 0; double start = now();
  for (int i = 0; i < reps; i++) sum += run(0, in, n, back);
  printf("c deflate %zu B %.2f us/op (checksum %zu)\n", n, (now() - start) / reps, sum);
  sum = 0; start = now();
  for (int i = 0; i < reps; i++) sum += run(1, packed, packedLength, back);
  printf("c inflate %zu B %.2f us/op (checksum %zu)\n", n, (now() - start) / reps, sum);
  return 0;
}
`,
  );
  const binary = join(directory, "bench");
  const built = spawnSync("clang", ["-O2", "-o", binary, c, "-lz"], {
    encoding: "utf8",
  });
  if (built.status !== 0) console.log("C baseline skipped: " + built.stderr);
  else
    for (const [bytes, n] of cases) {
      const result = spawnSync(binary, [String(bytes), String(n)], {
        input: text(bytes),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      process.stdout.write(result.stdout);
    }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// Node (its bundled zlib).
for (const [bytes, n] of cases) {
  const input = Buffer.from(text(bytes)),
    packed = zlib.deflateSync(input);
  for (let i = 0; i < Math.min(n, 100); i++) zlib.deflateSync(input);
  let sum = 0,
    start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) sum += zlib.deflateSync(input).length;
  console.log(
    line(
      "node deflateSync " + bytes + " B",
      Number(process.hrtime.bigint() - start) / 1000 / n,
      sum,
    ),
  );
  sum = 0;
  start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) sum += zlib.inflateSync(packed).length;
  console.log(
    line(
      "node inflateSync " + bytes + " B",
      Number(process.hrtime.bigint() - start) / 1000 / n,
      sum,
    ),
  );
}
