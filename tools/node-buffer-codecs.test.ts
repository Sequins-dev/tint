import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bufferBytes,
  bufferEncoding,
  bufferText,
} from "../packages/native-runtime/src/node/buffer-codecs.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  bufferIdentitySource,
  runGeneralRealmSuiteCase,
} from "./native-general-suite.ts";

const textCases = [
  ["\ufeff¡\ud800", "utf-8"],
  ["A\ud800💥", "UCS-2"],
  ["ÿ💥", "binary"],
  ["ÿ💥", "ascii"],
  ["4\u0131fe3z22", "HEX"],
  ["Zx5", "hex"],
  ["4fa", "hex"],
  ["\u0159!Q=garbage", "BASE64"],
  ["-_+/G", "base64url"],
  ["a", "base64url"],
] as const;
const byteCases = [
  [[0xef, 0xbb, 0xbf, 0xc0, 0x80], "utf-8"],
  [[0x00, 0xd8, 0x33], "UTF-16LE"],
  [[0x80, 0xff, 0x42], "ascii"],
  [[0x80, 0xff, 0x42], "latin1"],
  [[0xaa, 0xff], "base64"],
  [[0xaa, 0xff], "base64url"],
  [[0xaa, 0xff], "hex"],
] as const;

test("Buffer encodings match Node's UTF, byte truncation and base decoders", () => {
  for (const [text, spelling] of textCases) {
    const encoding = bufferEncoding(spelling);
    assert.ok(encoding);
    assert.deepEqual(
      bufferBytes(text, encoding),
      new Uint8Array(
        Buffer.from(text, spelling.toLowerCase() as BufferEncoding),
      ),
    );
  }
  for (const [bytes, spelling] of byteCases) {
    const encoding = bufferEncoding(spelling);
    assert.ok(encoding);
    assert.equal(
      bufferText(new Uint8Array(bytes), encoding),
      Buffer.from(bytes).toString(spelling.toLowerCase() as BufferEncoding),
    );
  }
  assert.equal(bufferEncoding("ascii "), undefined);
});

test("Buffer encodings run in native typed code", () => {
  const lines = [
    'import { bufferBytes, bufferEncoding, bufferText } from "buffer-codecs";',
    "export function run(): number {",
  ];
  let code = 1;
  for (const [text, spelling] of textCases) {
    const hex = Buffer.from(
      text,
      spelling.toLowerCase() as BufferEncoding,
    ).toString("hex");
    lines.push(`
  {
    const encoding = bufferEncoding(${JSON.stringify(spelling)});
    if (encoding === undefined) return ${code};
    const actual = bufferBytes(${JSON.stringify(text)}, encoding);
    if (bufferText(actual, "hex") !== ${JSON.stringify(hex)}) return ${code};
  }`);
    code++;
  }
  for (const [bytes, spelling] of byteCases) {
    const expected = Buffer.from(bytes).toString(
      spelling.toLowerCase() as BufferEncoding,
    );
    lines.push(`
  {
    const encoding = bufferEncoding(${JSON.stringify(spelling)});
    if (encoding === undefined) return ${code};
    const bytes = new Uint8Array(${JSON.stringify(bytes)});
    if (bufferText(bytes, encoding) !== ${JSON.stringify(expected)}) return ${code};
  }`);
    code++;
  }
  lines.push("return 42;", "}");
  verifyHostedFixture(lines.join("\n"), "ffi-buffer-codecs", [
    ["buffer-codecs", "packages/native-runtime/src/node/buffer-codecs.ts"],
  ]);
});

test("Buffer identity and views match Node", async () => {
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    await import(
      "data:text/javascript," + encodeURIComponent(bufferIdentitySource)
    );
    assert.equal(process.exitCode, 42);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("Buffer identity and views run with the native ArrayBuffer owner", async () => {
  await runGeneralRealmSuiteCase("buffer-identity");
});

test("Buffer methods use the same native backing as their slices", () => {
  verifyHostedFixture(
    `
import { Buffer, isAscii, isUtf8, transcode } from "node:buffer";
export function run() {
  if (typeof Buffer.isEncoding !== "function" || !Buffer.isEncoding("UTF-8") || Buffer.isEncoding("utf8 ")) return 1;
  const bytes = Buffer.from("01230123");
  const window = bytes.subarray(1, 7);
  if (window.write("é", 0, 2) !== 2 || bytes.toString("hex") !== "30c3a93330313233") return 2;
  if (window.indexOf("01") !== 3 || bytes.lastIndexOf("23") !== 6 || !window.includes("é")) return 3;
  const target = Buffer.alloc(4);
  if (window.copy(target, 0, 0, 4) !== 4 || target.toString("hex") !== "c3a93330") return 4;
  if (target.compare(window, 0, 4) !== 0 || target.equals(window)) return 5;
  if (target.swap16() !== target || target.toString("hex") !== "a9c33033") return 6;
  const numbers = Buffer.alloc(16);
  if (numbers.writeIntBE(-0x102030405, 1, 5) !== 6 || numbers.readIntBE(1, 5) !== -0x102030405) return 7;
  if (numbers.writeDoubleLE(-0, 8) !== 16 || !Object.is(numbers.readDoubleLE(8), -0)) return 8;
  if (numbers.writeBigUInt64BE(0xfedcba9876543210n) !== 8 || numbers.readBigUint64BE() !== 0xfedcba9876543210n) return 9;
  if (numbers.writeBigInt64LE(-9223372036854775808n) !== 8 || numbers.readBigInt64LE() !== -9223372036854775808n) return 10;
  const encoder = new TextEncoder();
  const result = encoder.encodeInto("é!", numbers.subarray(1, 3));
  if (result.read !== 1 || result.written !== 2 || numbers.readUInt16BE(1) !== 0xc3a9) return 11;
  const decoder = new TextDecoder("unicodefffe", { fatal: true });
  if (decoder.encoding !== "utf-16be" || !decoder.fatal) return 12;
  if (decoder.decode(new DataView(new Uint8Array([0, 65]).buffer)) !== "A") return 13;
  if (new TextDecoder("latin1").decode(new Uint8Array([0x80])) !== "€") return 14;
  if (Buffer.from({ type: "Buffer", data: [1, 255] }).toString("hex") !== "01ff") return 15;
  if (Buffer.concat([Buffer.from("a"), Buffer.from("b")], 3).toString("hex") !== "616200") return 16;
  if (Buffer.alloc(5, "ab").toString() !== "ababa" || Buffer.allocUnsafeSlow(3).length !== 3) return 17;
  if (Buffer.copyBytesFrom(new Uint16Array([0, 0x1234]), 1).toString("hex") !== "3412") return 18;
  if (isAscii(encoder.encode("é")) || !isUtf8(encoder.encode("é")) || isUtf8(Buffer.from([0xff]))) return 19;
  if (transcode(Buffer.from("Aé"), "utf8", "ascii").toString() !== "A?") return 20;
  const jis = new TextDecoder("windows-31j");
  if (jis.decode(new Uint8Array([0x82]), { stream: true }) !== "" ||
      jis.decode(new Uint8Array([0xa0])) !== "あ") return 21;
  return 42;
}
`,
    "buffer-window-operations",
    [["node:buffer", "packages/native-runtime/src/node/buffer.ts"]],
    [],
    [],
    [],
    { managedBytes: 33554432, allocationCapacity: 524288 },
  );
});

test("typed native TextEncoder and TextDecoder use the shared codecs", () => {
  verifyHostedFixture(
    `
export function run(): number {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(4);
  const result = encoder.encodeInto("é", bytes);
  const decoder = new TextDecoder("utf-16be");
  const word = new Uint8Array([0, 65]);
  return result.read === 1 && result.written === 2 &&
    bytes[0] === 195 && decoder.decode(word) === "A" ? 42 : 1;
}
`,
    "m1p2-typed-text",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 4194304, allocationCapacity: 65536 },
  );
});

test("aligned Buffer allocations retain their backing through views", () => {
  verifyHostedFixture(
    `
import { Buffer } from "node:buffer";
import { getRawPointer } from "node:ffi";
export function run() {
  const alignment = 8192;
  const bytes = Buffer.allocUnsafeSlow(8, alignment);
  const view = bytes.subarray(1, 7);
  if (getRawPointer(bytes) % 8192n !== 0n) return 1;
  if (getRawPointer(view) !== getRawPointer(bytes) + 1n) return 2;
  view.fill(255);
  return view.buffer === bytes.buffer && bytes[1] === 255 ? 42 : 3;
}
`,
    "buffer-aligned-backing",
    [
      ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
      ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
    ],
    [],
    [],
    [],
    { managedBytes: 33554432, allocationCapacity: 524288 },
  );
});
