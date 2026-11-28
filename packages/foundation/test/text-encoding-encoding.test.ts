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
test("ASCII runs of any length move in bulk around other scalars", () => {
  const encoder = new TextEncoder(),
    decoder = new TextDecoder();
  for (const other of ["\u00e9", "\u2603", "\ud83d\ude00", "\ud800"])
    for (let run = 0; run <= 40; run++) {
      const ascii = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH".slice(
        0,
        run,
      );
      const value = ascii + other + ascii + "x" + other;
      const bytes = encoder.encode(value);
      assert.deepEqual(encodeUTF8(value), bytes);
      assert.equal(
        decodeUTF8(createUTF8Decoder(), bytes),
        decoder.decode(bytes),
      );
      for (let size = 0; size <= bytes.length; size += 3) {
        const actual = new Uint8Array(size).fill(0xcc),
          expected = new Uint8Array(size).fill(0xcc);
        assert.deepEqual(
          encodeUTF8Into(value, actual),
          encoder.encodeInto(value, expected),
        );
        assert.deepEqual(actual, expected);
      }
    }
});
test("streamed ASCII keeps chunk boundaries and a later U+FEFF as text", () => {
  const actual = createUTF8Decoder(),
    expected = new TextDecoder();
  for (const part of [
    [0x61, 0x62],
    [0x63],
    [0xef, 0xbb, 0xbf],
    [0x64, 0xe2, 0x98],
    [0x83, 0x65],
  ]) {
    const bytes = Uint8Array.from(part);
    assert.equal(
      decodeUTF8(actual, bytes, true),
      expected.decode(bytes, { stream: true }),
    );
  }
  assert.equal(decodeUTF8(actual, new Uint8Array(0)), expected.decode());
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
test("bulk and state machine decoding agree with TextDecoder on mixed input", () => {
  // Valid runs (decoded in bulk) around invalid and truncated sequences
  // (the state machine), a leading byte order mark, a later U+FEFF and
  // every scalar width, in chunks of every size.
  const encoder = new TextEncoder(),
    valid = encoder.encode("\ufeffA\u00e9\u4e16\ud83d\ude00z\ufeff"),
    inputs = [
      valid,
      Uint8Array.from([...valid, 0xe2, 0x82]),
      Uint8Array.from([...valid.subarray(0, 6), 0xff, ...valid.subarray(6)]),
      Uint8Array.from([0xef, 0xbb, 0xbf]),
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x80, 0x41]),
      Uint8Array.from([0xef, 0xbb]),
      Uint8Array.from([0x41, 0xc3, 0xa9, 0xed, 0xa0, 0x80, 0xc3]),
    ];
  for (const fatal of [false, true])
    for (const ignoreBOM of [false, true])
      for (const input of inputs)
        for (let size = 1; size <= input.length; size++) {
          const actual = createUTF8Decoder(fatal, ignoreBOM),
            expected = new TextDecoder("utf-8", { fatal, ignoreBOM });
          for (let at = 0; at <= input.length; at += size) {
            const part = input.subarray(at, at + size),
              stream = at + size < input.length;
            let want: string | undefined;
            try {
              want = expected.decode(part, { stream });
            } catch (error) {
              assert.ok(error instanceof TypeError);
            }
            const got = decodeUTF8(actual, part, stream);
            assert.equal(
              got,
              want,
              JSON.stringify({ fatal, ignoreBOM, input: [...input], size, at }),
            );
            if (want === undefined) break;
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

test("TextDecoder preserves UTF-16 sequences and the BOM across chunk boundaries", () => {
  for (const [label, bytes] of [
    ["unicodefffe", [0xfe, 0xff, 0xd8, 0x3d, 0xdc, 0xa5, 0, 0x41]],
    ["utf-16", [0xff, 0xfe, 0x3d, 0xd8, 0xa5, 0xdc, 0x41, 0]],
  ] as const) {
    const native = createNativeTextDecoder(label, { fatal: true });
    const reference = new TextDecoder(label, { fatal: true });
    assert.equal(native.encoding, reference.encoding);
    for (const byte of bytes) {
      const part = Uint8Array.of(byte);
      assert.equal(
        native.decode(part, { stream: true }),
        reference.decode(part, { stream: true }),
      );
    }
    assert.equal(native.decode(), reference.decode());
    assert.throws(() => native.decode(Uint8Array.of(0)), TypeError);
  }
});

test("TextDecoder recognizes the WHATWG Windows-1252 aliases", () => {
  const native = createNativeTextDecoder(" \tlatin1\n");
  assert.equal(native.encoding, "windows-1252");
  assert.equal(native.decode(Uint8Array.of(0x80, 0x41, 0x9f)), "€AŸ");
});

test("TextDecoder resolves legacy single-byte labels and decodes their indexes", () => {
  for (const [label, bytes] of [
    ["csibm866", [0x80, 0xaf, 0xf0]],
    ["iso-ir-144", [0xb0, 0xc1, 0xef]],
    ["cp1251", [0x80, 0xc0, 0xff]],
    ["koi8-ru", [0xa4, 0xc1, 0xff]],
    ["x-mac-roman", [0x80, 0xc1, 0xff]],
  ] as const) {
    const actual = createNativeTextDecoder(label);
    const expected = new TextDecoder(label);
    const input = Uint8Array.from(bytes);
    assert.equal(actual.encoding, expected.encoding);
    assert.equal(actual.decode(input), expected.decode(input));
  }
});

test("TextDecoder retains legacy multibyte state across streaming chunks", () => {
  for (const [label, bytes] of [
    ["gb18030", [0xdd, 0x7e, 0x90, 0x30, 0x81, 0x30]],
    ["gbk", [0xc4, 0xe3, 0xba, 0xc3]],
    ["big5", [0xa7, 0x41, 0xa6, 0x6e]],
    ["euc-kr", [0xc7, 0xd1, 0xb1, 0xdb]],
    ["windows-31j", [0x82, 0xa0, 0x82, 0xa2]],
    ["euc-jp", [0xa4, 0xa2, 0xa4, 0xa4]],
    ["iso-2022-jp", [0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b, 0x28, 0x42, 0x41]],
  ] as const) {
    const native = createNativeTextDecoder(label, { fatal: true });
    const reference = new TextDecoder(label, { fatal: true });
    assert.equal(native.encoding, reference.encoding);
    for (const byte of bytes) {
      const chunk = Uint8Array.of(byte);
      assert.equal(
        native.decode(chunk, { stream: true }),
        reference.decode(chunk, { stream: true }),
        label,
      );
    }
    assert.equal(native.decode(), reference.decode());
  }
});
