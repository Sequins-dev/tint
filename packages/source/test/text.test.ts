import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createSourceText, createSourceTextView } from "@tint/source/text";
const encoder = new TextEncoder();
function source(text: string) {
  const bytes = encoder.encode(text),
    r = createSourceText(bytes, bytes.length);
  assert.equal(r.ok, true);
  return r.value;
}
test("preserves original bytes, BOM, Unicode and line endings in an isolated snapshot", () => {
  const text = "\ufeffA\r\né中🙂\u2028e\u0301\0",
    bytes = encoder.encode(text),
    before = bytes.slice(),
    r = createSourceText(bytes, bytes.length);
  assert.equal(r.ok, true);
  bytes.fill(0);
  assert.equal(r.value.text, text);
  assert.deepEqual(r.value.copyBytes(), before);
  r.value.copyBytes().fill(0);
  assert.deepEqual(r.value.copyBytes(), before);
  const wrapped = new Uint8Array([0xff, ...before, 0xff]),
    slice = wrapped.subarray(1, wrapped.length - 1);
  assert.equal(createSourceText(slice, slice.length).ok, true);
  assert.equal(source("").lineCount, 1);
  assert.deepEqual(source("").positionAt(0), {
    ok: true,
    value: { line: 1, column: 1 },
  });
});
test("byte and UTF-16 conversions are exact and reject interiors rather than rounding", () => {
  const s = source("aé中🙂z"),
    boundaries = [
      [0, 0],
      [1, 1],
      [3, 2],
      [6, 3],
      [10, 5],
      [11, 6],
    ];
  for (const [byte, utf16] of boundaries) {
    assert.deepEqual(s.byteToUtf16(byte!), { ok: true, value: utf16 });
    assert.deepEqual(s.utf16ToByte(utf16!), { ok: true, value: byte });
  }
  for (const offset of [2, 4, 5, 7, 8, 9])
    assert.deepEqual(s.byteToUtf16(offset), {
      ok: false,
      error: "NOT_BOUNDARY",
    });
  assert.deepEqual(s.utf16ToByte(4), { ok: false, error: "NOT_BOUNDARY" });
  assert.deepEqual(s.positionAt(4), {
    ok: true,
    value: { line: 1, column: 5 },
  });
  for (const offset of [-1, 0.5, NaN, Infinity, 12])
    assert.deepEqual(s.byteToUtf16(offset), {
      ok: false,
      error: "INVALID_OFFSET",
    });
  for (const offset of [-1, 0.5, NaN, Infinity, 7]) {
    assert.deepEqual(s.utf16ToByte(offset), {
      ok: false,
      error: "INVALID_OFFSET",
    });
    assert.deepEqual(s.positionAt(offset), {
      ok: false,
      error: "INVALID_OFFSET",
    });
  }
});
test("line positions match TypeScript at every UTF-16 offset including CRLF and surrogate interiors", () => {
  for (const text of [
    "",
    "\r\n",
    "a\r\nb\rc\nd\u2028e\u2029",
    "\ufeff🙂\r\n\r\né\u0085\v\f\t中",
    "\n\r\r\n",
  ]) {
    const s = source(text),
      oracle = ts.createSourceFile("input.ts", text, ts.ScriptTarget.Latest);
    assert.equal(s.lineCount, oracle.getLineStarts().length);
    for (let offset = 0; offset <= text.length; offset++) {
      const p = oracle.getLineAndCharacterOfPosition(offset);
      assert.deepEqual(s.positionAt(offset), {
        ok: true,
        value: { line: p.line + 1, column: p.character + 1 },
      });
      assert.deepEqual(s.offsetAt(p.line + 1, p.character + 1), {
        ok: true,
        value: offset,
      });
    }
  }
  const s = source("a\r\nb");
  assert.deepEqual(s.positionAt(2), {
    ok: true,
    value: { line: 1, column: 3 },
  });
  for (const [line, column] of [
    [0, 1],
    [3, 1],
    [1, 0],
    [1, 4],
    [2, 3],
    [1, NaN],
    [1, Infinity],
    [1, 1.5],
  ])
    assert.deepEqual(s.offsetAt(line!, column!), {
      ok: false,
      error: "INVALID_POSITION",
    });
});
test("fatal standard decoding reports the offending byte or EOF and enforces the byte budget", () => {
  for (const [tail, offset] of [
    [[0x80], 0],
    [[0xc0, 0xaf], 0],
    [[0xe0, 0x9f, 0xbf], 1],
    [[0xed, 0xa0, 0x80], 1],
    [[0xf4, 0x90, 0x80, 0x80], 1],
    [[0xe2, 0x82, 65], 2],
    [[0xf0, 0x90, 0x80], 3],
  ] as const) {
    const bytes = new Uint8Array([65, ...tail]);
    assert.deepEqual(createSourceText(bytes, bytes.length), {
      ok: false,
      error: { kind: "invalid-utf8", byteOffset: offset + 1, sequenceStart: 1 },
    });
  }
  for (const limit of [-1, NaN, Infinity, 0.5, 0x100000000])
    assert.deepEqual(createSourceText(new Uint8Array(), limit), {
      ok: false,
      error: { kind: "invalid-limit" },
    });
  assert.deepEqual(createSourceText(new Uint8Array([0xff]), 0), {
    ok: false,
    error: { kind: "size-limit" },
  });
});
test("seeded Unicode mapping round-trips scalar boundaries across long ASCII runs", () => {
  let seed = 23,
    text = "ASCII".repeat(1000);
  for (let i = 0; i < 2000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    let cp = seed % 0x110000;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0x20;
    text += String.fromCodePoint(cp);
  }
  const s = source(text);
  let byte = 0,
    utf16 = 0;
  for (const scalar of text) {
    assert.deepEqual(s.byteToUtf16(byte), { ok: true, value: utf16 });
    assert.deepEqual(s.utf16ToByte(utf16), { ok: true, value: byte });
    byte += encoder.encode(scalar).length;
    utf16 += scalar.length;
  }
  assert.deepEqual(s.utf16ToByte(utf16), { ok: true, value: byte });
  assert.equal(s.text, text);
});

test("Node Buffer input is copied rather than retaining its slice alias", () => {
  const input = Buffer.from("original"),
    r = createSourceText(input, input.length);
  assert.equal(r.ok, true);
  input.fill(0);
  assert.deepEqual(r.value.copyBytes(), encoder.encode("original"));
  assert.equal(r.value.text, "original");
});

test("in-memory source views preserve every UTF-16 unit without encoding", () => {
  const text = "\ud800\r\nA\udfff\u2028🙂";
  const view = createSourceTextView(text);
  assert.equal(view.text, text);
  assert.equal(view.text.charCodeAt(0), 0xd800);
  assert.equal(view.text.charCodeAt(4), 0xdfff);
  assert.equal(view.lineCount, 3);
  for (let offset = 0; offset <= text.length; offset++) {
    const position = view.positionAt(offset);
    assert.ok(position.ok);
    assert.deepEqual(
      view.offsetAt(position.value.line, position.value.column),
      { ok: true, value: offset },
    );
  }
  assert.deepEqual(view.positionAt(NaN), {
    ok: false,
    error: "INVALID_OFFSET",
  });
  assert.deepEqual(view.offsetAt(0, 1), {
    ok: false,
    error: "INVALID_POSITION",
  });
  assert.equal(createSourceTextView("").lineCount, 1);
});

test("byte-backed sources and source views share line mapping", () => {
  const text = "\ufeffa\r\n中🙂\n\u2028\u2029z",
    decoded = source(text),
    view = createSourceTextView(text);
  for (let offset = 0; offset <= text.length; offset++)
    assert.deepEqual(view.positionAt(offset), decoded.positionAt(offset));
  for (let line = 0; line <= view.lineCount + 1; line++)
    for (let column = 0; column <= text.length + 1; column++)
      assert.deepEqual(
        view.offsetAt(line, column),
        decoded.offsetAt(line, column),
      );
});
test("UTF-8 widths change exactly at the encoding boundaries", () => {
  const scalars = [
    0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff,
  ];
  const text = String.fromCodePoint(...scalars),
    s = source(text);
  let byte = 0,
    utf16 = 0;
  for (const scalar of scalars) {
    assert.deepEqual(s.utf16ToByte(utf16), { ok: true, value: byte });
    byte += scalar < 0x80 ? 1 : scalar < 0x800 ? 2 : scalar < 0x10000 ? 3 : 4;
    utf16 += scalar < 0x10000 ? 1 : 2;
  }
  assert.equal(s.byteLength, byte);
  assert.deepEqual(s.byteToUtf16(byte), { ok: true, value: utf16 });
});
/** Per-character reference for the run-length encoded conversion tables:
 * every offset is converted by walking the string. */
function referenceConversions(text: string): {
  readonly toUtf16: (number | undefined)[];
  readonly toByte: (number | undefined)[];
} {
  const toUtf16: (number | undefined)[] = [],
    toByte: (number | undefined)[] = [];
  let byte = 0;
  for (let utf16 = 0; utf16 < text.length;) {
    const point = text.codePointAt(utf16)!,
      units = point > 0xffff ? 2 : 1,
      bytes = point < 0x80 ? 1 : point < 0x800 ? 2 : point > 0xffff ? 4 : 3;
    toUtf16[byte] = utf16;
    toByte[utf16] = byte;
    byte += bytes;
    utf16 += units;
  }
  toUtf16[byte] = text.length;
  toByte[text.length] = byte;
  toUtf16.length = byte + 1;
  toByte.length = text.length + 1;
  return { toUtf16, toByte };
}
test("run-length encoded width tables convert every offset of mixed ASCII, BMP and astral runs", () => {
  const texts = [
    "",
    "ascii only",
    "é",
    "éééé",
    "中中中",
    "🙂🙂🙂",
    "aéb中c🙂d",
    "éé中中🙂🙂éé",
    "ééa中中a🙂🙂a",
    "\u0080߿ࠀ￿\u{10000}\u{10ffff}",
    "x" + "é".repeat(50) + "y" + "中".repeat(7) + "🙂".repeat(3) + "z",
    "🙂é🙂é🙂中中é",
    "﻿é́é",
  ];
  for (const text of texts) {
    const s = source(text),
      expected = referenceConversions(text);
    assert.equal(s.byteLength, expected.toUtf16.length - 1, text);
    for (let byte = 0; byte < expected.toUtf16.length; byte++) {
      const utf16 = expected.toUtf16[byte];
      assert.deepEqual(
        s.byteToUtf16(byte),
        utf16 === undefined
          ? { ok: false, error: "NOT_BOUNDARY" }
          : { ok: true, value: utf16 },
        JSON.stringify({ text, byte }),
      );
    }
    for (let utf16 = 0; utf16 < expected.toByte.length; utf16++) {
      const byte = expected.toByte[utf16];
      assert.deepEqual(
        s.utf16ToByte(utf16),
        byte === undefined
          ? { ok: false, error: "NOT_BOUNDARY" }
          : { ok: true, value: byte },
        JSON.stringify({ text, utf16 }),
      );
    }
    for (const offset of [-1, 0.5, NaN, expected.toUtf16.length])
      assert.deepEqual(s.byteToUtf16(offset), {
        ok: false,
        error: "INVALID_OFFSET",
      });
    for (const offset of [-1, 0.5, NaN, expected.toByte.length])
      assert.deepEqual(s.utf16ToByte(offset), {
        ok: false,
        error: "INVALID_OFFSET",
      });
  }
});
