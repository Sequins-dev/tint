// Native node:zlib fixtures (docs/native-ffi.md, "zlib"): Tint's codecs over
// the system zlib, checked natively against the system-zlib oracle
// (compressed bytes) and Node (decompression, gunzip members, errors).
import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { systemDeflate } from "./zlib-oracle.ts";

const zlibModule = "packages/native-runtime/src/node/zlib.ts";

/** The fixture's deterministic inputs, built identically in TypeScript. */
function text(lines: number): string {
  let out = "";
  for (let i = 0; i < lines; i++)
    out +=
      "line " +
      String(i) +
      " " +
      String((i * 7919) % 1000) +
      " lorem ipsum dolor\n";
  return out;
}
function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++)
    bytes[i] = (seed * 131 + i * 7 + (i >> 8)) & 255;
  return bytes;
}
const fixtureHelpers = `function text(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++)
    out.push("line " + String(i) + " " + String((i * 7919) % 1000) + " lorem ipsum dolor\\n");
  return out.join("");
}
function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (seed * 131 + i * 7 + (i >> 8)) & 255;
  return bytes;
}
function digest(bytes: Uint8Array): string {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return typeof hex === "string" ? hex : "";
}
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const high = hex.charCodeAt(i * 2), low = hex.charCodeAt(i * 2 + 1);
    bytes[i] = (high > 57 ? high - 87 : high - 48) * 16 + (low > 57 ? low - 87 : low - 48);
  }
  return bytes;
}
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  return bytes;
}`;
const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const utf8 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value));

/** Every native check returns its own code; 42 means all passed. */
export function zlibFixtureSource(): string {
  const medium = utf8(text(2000)),
    large = utf8(text(20000)),
    binary = pattern(1048576 + 13, 5);
  const checks: string[] = [];
  let code = 0;
  function check(condition: string, label: string): void {
    code++;
    checks.push(`  if (!(${condition})) return ${code}; // ${label}`);
  }
  // Compressed bytes equal the system zlib's (every level, each mode,
  // window/memory/strategy options, chunk sizes) and inflate back.
  check(
    `digest(deflateSync("")) === ${JSON.stringify(sha(systemDeflate(new Uint8Array(0), 1, -1)))}`,
    "empty deflate",
  );
  check(
    `deflateSync("").length === 8 && inflateSync(deflateSync("")).length === 0`,
    "empty round trip",
  );
  for (const level of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    check(
      `digest(deflateSync(medium, { level: ${level} })) === ${JSON.stringify(sha(systemDeflate(medium, 1, level)))}`,
      `level ${level}`,
    );
    check(
      `same(inflateSync(deflateSync(medium, { level: ${level} })), mediumBytes)`,
      `level ${level} round trip`,
    );
  }
  check(
    `digest(gzipSync(medium)) === ${JSON.stringify(sha(systemDeflate(medium, 3, -1)))}`,
    "gzip",
  );
  check(
    `digest(deflateRawSync(medium)) === ${JSON.stringify(sha(systemDeflate(medium, 5, -1)))}`,
    "raw",
  );
  check(
    `digest(deflateRawSync(medium, { windowBits: 8 })) === ${JSON.stringify(sha(systemDeflate(medium, 5, -1, 8)))}`,
    "raw window 8",
  );
  for (const [windowBits, memLevel, strategy] of [
    [9, 1, 0],
    [12, 3, 1],
    [15, 9, 2],
    [10, 5, 3],
    [11, 8, 4],
  ] as const)
    check(
      `digest(deflateSync(medium, { level: 7, windowBits: ${windowBits}, memLevel: ${memLevel}, strategy: ${strategy} })) === ${JSON.stringify(sha(systemDeflate(medium, 1, 7, windowBits, memLevel, strategy)))}`,
      `window ${windowBits} memLevel ${memLevel} strategy ${strategy}`,
    );
  // Multi-chunk streams: 64-byte windows mean thousands of zlib calls, each
  // allocating its output chunk in a small heap, so collections move managed
  // objects between calls while zlib holds pointers into external storage.
  check(
    `digest(deflateSync(large, { chunkSize: 64 })) === ${JSON.stringify(sha(systemDeflate(large, 1, -1, 15, 8, 0, 64)))}`,
    "large, 64-byte chunks",
  );
  check(
    `digest(deflateSync(binary, { level: 1, chunkSize: 1000 })) === ${JSON.stringify(sha(systemDeflate(binary, 1, 1, 15, 8, 0, 1000)))}`,
    "binary, 1000-byte chunks",
  );
  check(`same(inflateSync(deflateSync(binary)), binary)`, "binary round trip");
  check(
    `same(gunzipSync(gzipSync(large, { level: 9 }), { chunkSize: 64 }), largeBytes)`,
    "gzip round trip, 64-byte chunks",
  );
  check(
    `same(inflateRawSync(deflateRawSync(medium, { level: 2 })), mediumBytes)`,
    "raw round trip",
  );
  // Streams from Node's zlib inflate to the original bytes.
  const nodeDeflated = new Uint8Array(zlib.deflateSync(large, { level: 9 })),
    nodeGzip = new Uint8Array(zlib.gzipSync(medium)),
    nodeRaw = new Uint8Array(zlib.deflateRawSync(medium, { level: 1 }));
  check(
    `same(inflateSync(fromHex(${JSON.stringify(hex(nodeDeflated))}), { chunkSize: 64 }), largeBytes)`,
    "Node deflate stream",
  );
  check(
    `same(gunzipSync(fromHex(${JSON.stringify(hex(nodeGzip))})), mediumBytes)`,
    "Node gzip stream",
  );
  check(
    `same(inflateRawSync(fromHex(${JSON.stringify(hex(nodeRaw))})), mediumBytes)`,
    "Node raw stream",
  );
  check(
    `same(unzipSync(fromHex(${JSON.stringify(hex(nodeGzip))})), mediumBytes)`,
    "unzip gzip",
  );
  check(`same(unzipSync(deflateSync(medium)), mediumBytes)`, "unzip deflate");
  // Node's own deflate output inflates in Node: the oracle's does too.
  if (
    Buffer.compare(
      zlib.inflateSync(systemDeflate(large, 1, 9)),
      Buffer.from(large),
    ) !== 0
  )
    throw Error("Node cannot inflate the system zlib's stream");
  // gunzip members: concatenated members, zero padding, trailing garbage.
  const members = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def")]);
  check(
    `same(gunzipSync(fromHex(${JSON.stringify(hex(members))})), ascii("abcdef"))`,
    "gzip members",
  );
  check(
    `same(gunzipSync(fromHex(${JSON.stringify(hex(Buffer.concat([zlib.gzipSync("abc"), Buffer.alloc(3)])))})), ascii("abc"))`,
    "gzip zero padding",
  );
  check(
    `throwsZlib("Z_DATA_ERROR", -3, () => gunzipSync(fromHex(${JSON.stringify(hex(Buffer.concat([zlib.gzipSync("abc"), Buffer.from("xyz")])))})))`,
    "gzip trailing garbage",
  );
  check(
    `same(inflateSync(fromHex(${JSON.stringify(hex(Buffer.concat([zlib.deflateSync("abc"), Buffer.from("xyz")])))})), ascii("abc"))`,
    "inflate ignores trailing bytes",
  );
  // Corrupt, truncated and empty inputs carry Node's zlib status fields.
  const truncated = new Uint8Array(
    zlib.deflateSync("hello world").subarray(0, 8),
  );
  check(
    `throwsZlib("Z_BUF_ERROR", -5, () => inflateSync(new Uint8Array(0)))`,
    "empty inflate",
  );
  check(
    `throwsZlib("Z_DATA_ERROR", -3, () => inflateSync(ascii("garbage")))`,
    "garbage inflate",
  );
  check(
    `throwsZlib("Z_BUF_ERROR", -5, () => inflateSync(fromHex(${JSON.stringify(hex(truncated))})))`,
    "truncated inflate",
  );
  check(
    `same(inflateSync(fromHex(${JSON.stringify(hex(truncated))}), { finishFlush: 2 }), fromHex(${JSON.stringify(hex(zlib.inflateSync(truncated, { finishFlush: zlib.constants.Z_SYNC_FLUSH })))}))`,
    "truncated sync flush",
  );
  check(
    `throwsZlib("Z_DATA_ERROR", -3, () => gunzipSync(deflateSync("abc")))`,
    "gunzip of zlib data",
  );
  check(
    `throwsZlib("Z_DATA_ERROR", -3, () => inflateRawSync(fromHex("ffff")))`,
    "invalid block type",
  );
  check(
    `throwsZlib("Z_DATA_ERROR", -3, () => inflateSync(deflateSync("abc", { windowBits: 15 }), { windowBits: 9 }))`,
    "window too small",
  );
  // Option validation (RangeError, as Node), defaults and truncation.
  check(`throwsRange(() => deflateSync("abc", { level: 10 }))`, "level range");
  check(
    `throwsRange(() => deflateSync("abc", { chunkSize: 10 }))`,
    "chunk range",
  );
  check(
    `throwsRange(() => gzipSync("abc", { windowBits: 8 }))`,
    "gzip window range",
  );
  check(
    `throwsRange(() => deflateSync("abc", { memLevel: 0 }))`,
    "memLevel range",
  );
  check(
    `throwsRange(() => deflateSync("abc", { strategy: 5 }))`,
    "strategy range",
  );
  check(
    `throwsRange(() => deflateSync("abc", { level: Infinity }))`,
    "infinite level",
  );
  check(
    `throwsRange(() => inflateSync(deflateSync("abc"), { maxOutputLength: 2 }), "ERR_BUFFER_TOO_LARGE")`,
    "max output",
  );
  check(
    `same(deflateSync(medium, { level: NaN }), deflateSync(medium))`,
    "NaN level",
  );
  check(
    `same(deflateSync(medium, { level: 1.5 }), deflateSync(medium, { level: 1 }))`,
    "fractional level",
  );
  check(
    `same(deflateSync(ascii("abc")), deflateSync("abc")) && same(deflateSync(ascii("xabcx").subarray(1, 4)), deflateSync("abc"))`,
    "byte and view input",
  );
  return `import { createHash } from "node:crypto";
import { deflateSync, inflateSync, deflateRawSync, inflateRawSync, gzipSync, gunzipSync, unzipSync } from "node:zlib";
${fixtureHelpers}
function throwsZlib(code: string, errno: number, f: () => Uint8Array): boolean {
  try { f(); } catch (error) {
    return error instanceof Error && !(error instanceof TypeError) &&
      "code" in error && error.code === code && "errno" in error && error.errno === errno;
  }
  return false;
}
function throwsRange(f: () => Uint8Array, code: string = "ERR_OUT_OF_RANGE"): boolean {
  try { f(); } catch (error) {
    return error instanceof RangeError && "code" in error && error.code === code;
  }
  return false;
}
export function run(): number {
  const medium = text(2000), large = text(20000);
  const mediumBytes = ascii(medium), largeBytes = ascii(large);
  const binary = pattern(1048576 + 13, 5);
  if (digest(mediumBytes) !== ${JSON.stringify(sha(medium))} || digest(binary) !== ${JSON.stringify(sha(binary))}) return 99;
${checks.join("\n")}
  return 42;
}
`;
}
export function verifyZlibFixture(): string {
  return verifyHostedFixture(
    zlibFixtureSource(),
    "ffi-zlib",
    [
      ["node:zlib", zlibModule],
      ["node:crypto", "packages/native-runtime/src/node/crypto.ts"],
    ],
    [],
    [],
    [],
    {
      managedBytes: 16777216,
      allocationCapacity: 262144,
    },
  );
}
