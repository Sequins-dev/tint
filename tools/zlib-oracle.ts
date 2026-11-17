// Test-time oracle for node:zlib over the system zlib (docs/native-ffi.md,
// "zlib"): a clang-compiled C program drives /usr/lib/libz.1.dylib with
// Node's synchronous calling pattern (one init, then deflate/inflate calls
// of `chunkSize` output each until the window is not exhausted). Node
// bundles a different zlib (Chromium's), whose deflate output differs, so
// compressed bytes are compared with this oracle, and its output is checked
// to inflate with Node. clang is never part of Tint's build or link.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = String.raw`#include <zlib.h>
#include <stdio.h>
#include <stdlib.h>
/* usage: oracle mode level windowBits memLevel strategy chunkSize < input */
int main(int argc, char **argv) {
  if (argc != 7) return 64;
  int mode = atoi(argv[1]), level = atoi(argv[2]), bits = atoi(argv[3]),
      memLevel = atoi(argv[4]), strategy = atoi(argv[5]);
  size_t chunk = (size_t)atol(argv[6]), size = 0, capacity = 1 << 16, n;
  unsigned char *in = malloc(capacity), *out = malloc(chunk);
  while ((n = fread(in + size, 1, capacity - size, stdin)) > 0) {
    size += n;
    if (size == capacity) in = realloc(in, capacity *= 2);
  }
  z_stream s = {0};
  if (mode == 3) bits += 16;
  if (mode == 5) bits = -(bits == 8 ? 9 : bits);
  if (deflateInit2(&s, level, Z_DEFLATED, bits, memLevel, strategy) != Z_OK)
    return 65;
  s.next_in = in;
  s.avail_in = (uInt)size;
  for (;;) {
    s.next_out = out;
    s.avail_out = (uInt)chunk;
    int status = deflate(&s, Z_FINISH);
    if (status != Z_OK && status != Z_STREAM_END && status != Z_BUF_ERROR)
      return 66;
    fwrite(out, 1, chunk - s.avail_out, stdout);
    if (s.avail_out != 0) break;
  }
  deflateEnd(&s);
  return 0;
}
`;
let compiled: string | undefined;
/** Why the oracle is unavailable (clang missing), else undefined. */
export function zlibOracleUnavailable(): string | undefined {
  const clang = spawnSync("clang", ["--version"], { encoding: "utf8" });
  return clang.error !== undefined || clang.status !== 0
    ? "clang is not installed (test-only zlib oracle)"
    : undefined;
}
/** The system zlib's deflate output for Node's mode numbering (1 deflate,
 * 3 gzip, 5 raw) and options. */
export function systemDeflate(
  input: Uint8Array,
  mode: 1 | 3 | 5,
  level: number,
  windowBits = 15,
  memLevel = 8,
  strategy = 0,
  chunkSize = 16384,
): Uint8Array {
  if (compiled === undefined) {
    const directory = mkdtempSync(join(tmpdir(), "tint-zlib-oracle-"));
    process.on("exit", () =>
      rmSync(directory, { recursive: true, force: true }),
    );
    writeFileSync(join(directory, "oracle.c"), source);
    const built = spawnSync(
      "clang",
      [
        "-O1",
        "-o",
        join(directory, "oracle"),
        join(directory, "oracle.c"),
        "-lz",
      ],
      { encoding: "utf8" },
    );
    if (built.status !== 0)
      throw Error("zlib oracle build failed: " + built.stderr);
    compiled = join(directory, "oracle");
  }
  const result = spawnSync(
    compiled,
    [mode, level, windowBits, memLevel, strategy, chunkSize].map(String),
    { input, maxBuffer: 1 << 28 },
  );
  if (result.status !== 0)
    throw Error("zlib oracle failed with status " + String(result.status));
  return new Uint8Array(result.stdout);
}
