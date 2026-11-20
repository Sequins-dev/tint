import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bufferBytes,
  bufferEncoding,
  bufferText,
} from "../packages/native-runtime/src/node/buffer-codecs.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

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

const bufferIdentity = `
import { Buffer } from "node:buffer";
export function run() {
  if (globalThis.Buffer !== Buffer ||
      Object.getPrototypeOf(Buffer) !== Uint8Array ||
      Object.getPrototypeOf(Buffer.prototype) !== Uint8Array.prototype) return 1;
  const bytes = Buffer.from([0x6f, 0x6b, 0]);
  if (!Buffer.isBuffer(bytes) || !(bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(bytes) !== Buffer.prototype ||
      Buffer.isBuffer(new Uint8Array(1)) || Buffer.isBuffer(Buffer.prototype)) return 2;
  const sub = bytes.subarray(-2, -1);
  const slice = bytes.slice(0, 2);
  if (!Buffer.isBuffer(sub) || !Buffer.isBuffer(slice) ||
      sub.buffer !== bytes.buffer || slice.buffer !== bytes.buffer ||
      sub.byteOffset !== bytes.byteOffset + 1 || sub.toString() !== "k") return 3;
  sub[0] = 0x6d;
  if (bytes[1] !== 0x6d || slice.toString() !== "om") return 4;
  const backing = new ArrayBuffer(4);
  const alias = Buffer.from(backing, 1, 2);
  const data = new Uint8Array(backing);
  alias[0] = 42;
  if (alias.buffer !== backing || alias.byteOffset !== 1 || data[1] !== 42) return 5;
  const copied = Buffer.from(alias);
  alias[0] = 37;
  if (copied[0] !== 42 || copied.buffer === backing) return 6;
  if (Buffer.from("A", "UCS-2").toString("hex") !== "4100" ||
      Buffer.alloc(5, "AB").toString("ascii") !== "ABABA" ||
      Buffer.alloc(0).length !== 0) return 7;
  try { Buffer.from("x", "missing"); return 8; }
  catch (error) { if (!(error instanceof TypeError) || error.code !== "ERR_UNKNOWN_ENCODING") return 8; }
  return 42;
}`;

test("Buffer identity and views match Node", async () => {
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(bufferIdentity)
  )) as { run(): number };
  assert.equal(fixture.run(), 42);
});

test("Buffer identity and views run with the native ArrayBuffer owner", () => {
  let general: readonly string[] | undefined;
  verifyHostedFixture(
    bufferIdentity,
    "ffi-buffer-identity",
    [["node:buffer", "packages/native-runtime/src/node/buffer.ts"]],
    [],
    [],
    [
      {
        module: "packages/native-runtime/src/node/buffer.ts",
        namespace: "node-buffer",
        retainedExports: [],
      },
    ],
    {
      onGeneralFallback(modules) {
        general = modules;
      },
      managedBytes: 67108864,
      allocationCapacity: 1048576,
    },
  );
  assert.deepEqual(general, ["fixture"]);
});
