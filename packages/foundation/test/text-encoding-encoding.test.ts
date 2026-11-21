import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNativeTextEncoder,
  createNativeTextDecoder,
  encodeUTF8,
  encodeUTF8Into,
  createUTF8Decoder,
  decodeUTF8,
} from "../src/text/text-encoding/index.ts";
test("native UTF-8 encoder matches TextEncoder including lone surrogates", () => {
  const encoder = new TextEncoder();
  for (const value of [
    "",
    "abc",
    "\u0000",
    "é",
    "☃",
    "😀",
    "\ud800",
    "\udc00",
    "a\ud800b",
    "\ud800\ud800\udc00",
    "\ufeffx",
  ])
    assert.deepEqual(encodeUTF8(value), encoder.encode(value));
});
test("encodeInto counts UTF-16 units and never splits a scalar", () => {
  const encoder = new TextEncoder();
  for (const value of ["aé😀z", "\ud800x", "\ud800\udc00", "☃"])
    for (let size = 0; size < 14; size++) {
      const actual = new Uint8Array(size).fill(0xcc),
        expected = new Uint8Array(size).fill(0xcc);
      assert.deepEqual(
        encodeUTF8Into(value, actual),
        encoder.encodeInto(value, expected),
      );
      assert.deepEqual(actual, expected);
    }
});
test("encodeInto resumes at a UTF-16 offset using the same destination", () => {
  const encoder = new TextEncoder();
  const text = "ascii\0\u007f\u0080é\u07ff\u0800雪😀\ud800x\udc00";
  for (let size = 0; size <= 9; size++) {
    const actual = new Uint8Array(size);
    const expected = new Uint8Array(size);
    for (let start = 0; start <= text.length; start++) {
      actual.fill(0xcc);
      expected.fill(0xcc);
      assert.deepEqual(
        encodeUTF8Into(text, actual, start),
        encoder.encodeInto(text.slice(start), expected),
      );
      assert.deepEqual(actual, expected);
    }
  }
});
test("UTF-8 encodes exact output around SIMD and scratch window boundaries", () => {
  const encoder = new TextEncoder();
  for (let length = 0; length <= 17; length++) {
    const prefix = "a".repeat(length);
    for (const text of [prefix, prefix + "😀\ud800é\udc00雪" + prefix]) {
      assert.deepEqual(encodeUTF8(text), encoder.encode(text));
      for (let capacity = 0; capacity <= 17; capacity++) {
        const actual = new Uint8Array(capacity + 2).fill(0xcc);
        const expected = actual.slice();
        assert.deepEqual(
          encodeUTF8Into(text, actual.subarray(1, capacity + 1)),
          encoder.encodeInto(text, expected.subarray(1, capacity + 1)),
        );
        assert.deepEqual(actual, expected);
      }
    }
  }
  for (let length = 4093; length <= 4097; length++) {
    const text = "a".repeat(length) + "😀\ud800x\udc00" + "b".repeat(17);
    const expected = encoder.encode(text);
    const actual = new Uint8Array(expected.length);
    const scratch = new Uint8Array(4096);
    let read = 0;
    let written = 0;
    while (read < text.length) {
      const chunk = encodeUTF8Into(text, scratch, read);
      assert.ok(chunk.read > 0);
      actual.set(scratch.subarray(0, chunk.written), written);
      read += chunk.read;
      written += chunk.written;
    }
    assert.equal(written, expected.length);
    assert.deepEqual(actual, expected);
    assert.deepEqual(encodeUTF8(text), expected);
  }
});
test("decoder follows UTF-8 error recovery and stream boundaries", () => {
  const cases = [
    [0xef, 0xbb, 0xbf, 65],
    [0xf0, 0x9f, 0x98, 0x80],
    [0xc0, 0xaf],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 65, 0xa1],
    [0xe2, 0x82],
    [0x80, 0xff],
    [],
    [65, 0, 66],
  ];
  for (const fatal of [false, true])
    for (const ignoreBOM of [false, true])
      for (const values of cases)
        for (let split = 0; split <= values.length; split++) {
          const actual = createUTF8Decoder(fatal, ignoreBOM),
            expected = new TextDecoder("utf-8", { fatal, ignoreBOM });
          const input = Uint8Array.from(values);
          for (const [part, stream] of [
            [input.subarray(0, split), true],
            [input.subarray(split), false],
            [new Uint8Array([65]), false],
          ] as const) {
            let want: string | undefined;
            try {
              want = expected.decode(part, { stream });
            } catch (error) {
              assert.ok(error instanceof TypeError);
            }
            assert.equal(
              decodeUTF8(actual, part, stream),
              want,
              JSON.stringify({ fatal, ignoreBOM, values, split, stream }),
            );
          }
        }
});
test("native global adapters retain standard UTF-8 options and branded failures", () => {
  const encoder = createNativeTextEncoder();
  assert.equal(encoder.encoding, "utf-8");
  assert.deepEqual(encoder.encode(), new Uint8Array());
  for (const label of ["utf-8", "UTF8", " \tUnicode-1-1-UTF-8\n"]) {
    const decoder = createNativeTextDecoder(label, {
      fatal: true,
      ignoreBOM: true,
    });
    assert.equal(decoder.encoding, "utf-8");
    assert.equal(decoder.fatal, true);
    assert.equal(decoder.ignoreBOM, true);
    assert.equal(decoder.decode(encoder.encode("😀")), "😀");
    assert.throws(() => decoder.decode(new Uint8Array([0xff])), TypeError);
    assert.equal(decoder.decode(), "");
  }
  assert.throws(() => createNativeTextDecoder("no-such-encoding"), RangeError);
  const decoder = createNativeTextDecoder();
  assert.equal(
    decoder.decode(new Uint8Array([0xef, 0xbb]), { stream: true }),
    "",
  );
  assert.equal(decoder.decode(new Uint8Array([0xbf, 65])), "A");
});
