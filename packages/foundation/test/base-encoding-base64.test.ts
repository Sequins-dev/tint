import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeBase64Into,
  encodeBase64,
} from "../src/text/base-encoding/index.ts";

function decode(
  source: string,
  size: number,
  mode: "loose" | "strict" | "stop-before-partial" = "loose",
  alphabet: "base64" | "base64url" = "base64",
) {
  const bytes = new Uint8Array(size + 2).fill(255);
  const result = decodeBase64Into(source, bytes, 1, size, alphabet, mode);
  assert.equal(bytes[0], 255);
  assert.equal(bytes[size + 1], 255);
  return { ...result, bytes: [...bytes.slice(1, 1 + result.written)] };
}

test("base64 commits complete chunks and reports original input boundaries", () => {
  assert.deepEqual(decode("Zm9vYmFy", 5), {
    read: 4,
    written: 3,
    error: "none",
    bytes: [102, 111, 111],
  });
  assert.deepEqual(decode("Zm9vYmE=", 5), {
    read: 8,
    written: 5,
    error: "none",
    bytes: [102, 111, 111, 98, 97],
  });
  assert.deepEqual(decode("  Z m 9 v \n ", 3), {
    read: 9,
    written: 3,
    error: "none",
    bytes: [102, 111, 111],
  });
  assert.equal(decode("  Z m 9 v \n ", 4).read, 12);
  assert.deepEqual(decode("aa#", 1), {
    read: 0,
    written: 0,
    error: "syntax",
    bytes: [],
  });
  assert.deepEqual(decode("aaaA", 1), {
    read: 0,
    written: 0,
    error: "none",
    bytes: [],
  });
  assert.equal(decode("#", 0, "strict").error, "none");
});

test("base64 validates padding and unused bits before committing final bytes", () => {
  assert.deepEqual(decode("ZXhhZh==", 6, "strict"), {
    read: 4,
    written: 3,
    error: "syntax",
    bytes: [101, 120, 97],
  });
  assert.deepEqual(decode("ZXhhZh==", 6), {
    read: 8,
    written: 4,
    error: "none",
    bytes: [101, 120, 97, 102],
  });
  for (const source of [
    "Zg===",
    "Zg==x",
    "Zg=",
    "=Zg=",
    "Zg==\u00a0",
    "Zg==\v",
  ])
    assert.equal(decode(source, 8).error, "syntax", source);
  assert.deepEqual(decode("Zg==", 1, "strict"), {
    read: 4,
    written: 1,
    error: "none",
    bytes: [102],
  });
  assert.deepEqual(decode("Zm8=", 1), {
    read: 0,
    written: 0,
    error: "none",
    bytes: [],
  });
});

test("base64 partial modes, alphabets and permitted whitespace remain distinct", () => {
  assert.deepEqual(decode("Zg", 2), {
    read: 2,
    written: 1,
    error: "none",
    bytes: [102],
  });
  assert.equal(decode("Zg", 2, "strict").error, "syntax");
  assert.deepEqual(decode("Zg", 2, "stop-before-partial"), {
    read: 0,
    written: 0,
    error: "none",
    bytes: [],
  });
  assert.deepEqual(decode("Zg=", 2, "stop-before-partial"), {
    read: 0,
    written: 0,
    error: "none",
    bytes: [],
  });
  assert.deepEqual(
    decode("x-_y", 3, "strict", "base64url").bytes,
    [199, 239, 242],
  );
  assert.equal(decode("x+/y", 3, "strict", "base64url").error, "syntax");
  assert.equal(decode("x-_y", 3).error, "syntax");
  for (const source of ["Z\tg==", "Z\ng==", "Z\fg==", "Z\rg==", "Z g=="])
    assert.equal(decode(source, 2).error, "none", source);
});

test("base64 encoders match valid independent output with and without padding", () => {
  let state = 721;
  for (let length = 0; length < 100; length++) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      bytes[i] = state >>> 24;
    }
    for (const alphabet of ["base64", "base64url"] as const)
      for (const omitPadding of [false, true]) {
        const expected = Buffer.from(bytes)
          .toString("base64")
          .replace(/\+/g, alphabet === "base64url" ? "-" : "+")
          .replace(/\//g, alphabet === "base64url" ? "_" : "/");
        const encoded = encodeBase64(bytes, 0, length, alphabet, omitPadding);
        assert.equal(
          encoded,
          omitPadding ? expected.replace(/=+$/, "") : expected,
        );
        assert.ok(encoded !== undefined);
        assert.deepEqual(decode(encoded, length, "loose", alphabet).bytes, [
          ...bytes,
        ]);
      }
  }
  assert.equal(
    encodeBase64(new Uint8Array(2), 1, 2, "base64", false),
    undefined,
  );
  assert.equal(
    decodeBase64Into("Zg==", new Uint8Array(2), 1, 2, "base64", "loose").error,
    "bounds",
  );
});
