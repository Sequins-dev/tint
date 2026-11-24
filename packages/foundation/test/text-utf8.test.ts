import assert from "node:assert/strict";
import { test } from "node:test";
import {
  utf8ByteLength,
  utf8Text,
  utf8WholeText,
  writeUTF8,
} from "../src/text/utf8.ts";

const encoder = new TextEncoder(),
  fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Strings covering every scalar width, surrogate pairs, lone surrogates
 * of both kinds and a byte order mark. */
const samples = [
  "",
  "plain ASCII text",
  "café crème ÿ\u0080",
  "߿ࠀ 世界 ￿",
  "😀 pair, \ud800 lone high, \udc00 lone low, 􏿿",
  "﻿bom then é",
  "\ud800",
  "x\udc00\ud800",
  "line 1: the quick brown 狐 jumps over the lazy 犬\n".repeat(4),
];

/** The longest prefix of bytes [begin, limit) that decodes without error. */
function validPrefix(bytes: Uint8Array, begin: number, limit: number): number {
  for (let end = limit; end > begin; end--) {
    try {
      fatal.decode(bytes.subarray(begin, end));
      return end;
    } catch {
      // Shorter.
    }
  }
  return begin;
}

test("utf8ByteLength counts a range's encoded bytes", () => {
  for (const text of samples)
    for (let begin = 0; begin <= text.length; begin++)
      for (let limit = begin; limit <= text.length; limit++)
        assert.equal(
          utf8ByteLength(text, begin, limit),
          encoder.encode(text.slice(begin, limit)).length,
          JSON.stringify([text, begin, limit]),
        );
});

test("writeUTF8 encodes whole scalars while they fit", () => {
  for (const text of samples) {
    const full = encoder.encode(text);
    for (let capacity = 0; capacity <= full.length + 2; capacity++) {
      const bytes = new Uint8Array(capacity + 3).fill(0xcc),
        view = bytes.subarray(0, capacity + 3),
        expected = new Uint8Array(capacity),
        result = encoder.encodeInto(text, expected);
      // Written at offset 3 of a window of capacity + 3 bytes.
      const read = writeUTF8(text, 0, text.length, view, 3);
      assert.equal(read, result.read, JSON.stringify([text, capacity]));
      assert.deepEqual(
        [...bytes.subarray(3, 3 + result.written)],
        [...expected.subarray(0, result.written)],
      );
      assert.ok(bytes.subarray(3 + result.written).every((b) => b === 0xcc));
      assert.ok(bytes.subarray(0, 3).every((b) => b === 0xcc));
    }
    // Ranges: a pair split by a range end is two lone surrogates.
    for (let begin = 0; begin <= text.length; begin++)
      for (let limit = begin; limit <= text.length; limit++) {
        const part = text.slice(begin, limit),
          bytes = new Uint8Array(encoder.encode(part).length);
        assert.equal(writeUTF8(text, begin, limit, bytes, 0), limit);
        assert.deepEqual(bytes, encoder.encode(part));
      }
  }
});

test("utf8Text decodes the longest valid prefix", () => {
  for (const text of samples) {
    const bytes = encoder.encode(text);
    // Lone surrogates encoded as U+FFFD decode as U+FFFD.
    assert.equal(utf8Text(bytes, 0, bytes.length), fatal.decode(bytes));
    for (let begin = 0; begin <= bytes.length; begin++)
      for (let limit = begin; limit <= bytes.length; limit++) {
        const end = validPrefix(bytes, begin, limit),
          prefix = fatal.decode(bytes.subarray(begin, end));
        assert.equal(utf8Text(bytes, begin, limit), prefix);
        // The whole range, or the empty string.
        assert.equal(
          utf8WholeText(bytes, begin, limit),
          end === limit ? prefix : "",
        );
      }
  }
  // Every two-byte input, and three- and four-byte inputs around each
  // lead's continuation bounds.
  const pair = new Uint8Array(2);
  for (let a = 0; a < 256; a++)
    for (let b = 0; b < 256; b++) {
      pair[0] = a;
      pair[1] = b;
      assert.equal(
        utf8Text(pair, 0, 2),
        fatal.decode(pair.subarray(0, validPrefix(pair, 0, 2))),
      );
    }
  const edges = [0x00, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xff];
  for (let lead = 0xc0; lead < 0x100; lead++)
    for (const b of edges)
      for (const c of edges)
        for (const d of edges) {
          const bytes = Uint8Array.from([lead, b, c, d]);
          assert.equal(
            utf8Text(bytes, 0, 4),
            fatal.decode(bytes.subarray(0, validPrefix(bytes, 0, 4))),
            JSON.stringify([...bytes]),
          );
        }
});

test("out-of-range indices are invariant failures", () => {
  const bytes = new Uint8Array(4);
  assert.throws(() => utf8ByteLength("ab", 1, 3));
  assert.throws(() => utf8ByteLength("ab", 2, 1));
  assert.throws(() => utf8ByteLength("ab", 0.5, 1));
  assert.throws(() => writeUTF8("ab", 0, 2, bytes, 5));
  assert.throws(() => writeUTF8("ab", 0, 2, bytes, -1));
  assert.throws(() => utf8Text(bytes, 0, 5));
  assert.throws(() => utf8Text(bytes, -1, 2));
  assert.throws(() => utf8WholeText(bytes, 2, 1));
});
