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
