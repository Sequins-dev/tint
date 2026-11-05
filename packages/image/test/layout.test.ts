import { test } from "node:test";
import assert from "node:assert/strict";
import {
  link,
  type LayoutRequest,
  type Fixup,
  type LayoutErrorCode,
} from "@tint/image/layout";

function fixture(): LayoutRequest {
  return {
    maxByteLength: 1024,
    virtualBase: { lo: 0xfffffff0, hi: 0x12345678 },
    fragments: [
      {
        id: "data",
        order: 1,
        alignment: 16,
        bytes: new Uint8Array([0xaa, 0xbb]),
      },
      { id: "header", order: 0, alignment: 1, bytes: new Uint8Array(16) },
    ],
    symbols: [
      { id: "target", fragment: "data", offset: 0 },
      { id: "start", fragment: "header", offset: 0 },
    ],
    fixups: [
      {
        id: "pointer",
        kind: "absolute",
        addressSpace: "virtual",
        fragment: "header",
        offset: 0,
        width: 8,
        endian: "little",
        target: { symbol: "target", addend: 0 },
      },
      {
        id: "file",
        kind: "absolute",
        addressSpace: "file",
        fragment: "header",
        offset: 8,
        width: 4,
        endian: "big",
        target: { symbol: "target", addend: 0 },
      },
      {
        id: "back",
        kind: "relative",
        fragment: "header",
        offset: 12,
        width: 4,
        endian: "little",
        target: { symbol: "start", addend: 0 },
        origin: { symbol: "target", addend: 0 },
      },
    ],
  };
}
function failure(request: LayoutRequest, code: LayoutErrorCode) {
  const result = link(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
  assert.equal("value" in result, false);
}
test("links exact bytes with virtual carry, file offsets and negative displacement", () => {
  const input = fixture(),
    result = link(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    [...result.value.bytes],
    [
      0, 0, 0, 0, 0x79, 0x56, 0x34, 0x12, 0, 0, 0, 16, 0xf0, 0xff, 0xff, 0xff,
      0xaa, 0xbb,
    ],
  );
  assert.deepEqual(result.value.placements, [
    { id: "header", fileOffset: 0, byteLength: 16 },
    { id: "data", fileOffset: 16, byteLength: 2 },
  ]);
  assert.deepEqual(
    result.value.symbols.find((s) => s.id === "target"),
    { id: "target", fileOffset: 16, virtualAddress: { lo: 0, hi: 0x12345679 } },
  );
  assert.equal(
    input.fragments.find((f) => f.id === "header")?.bytes.every((b) => b === 0),
    true,
  );
  result.value.bytes[0] = 99;
  assert.equal(input.fragments.find((f) => f.id === "header")?.bytes[0], 0);
});
test("canonical output ignores registration order, including ties and padding", () => {
  const a = fixture(),
    b = {
      ...a,
      fragments: [...a.fragments].reverse(),
      symbols: [...a.symbols].reverse(),
      fixups: [...a.fixups].reverse(),
    };
  assert.deepEqual(link(a), link(b));
  const padded = link({
    ...a,
    fragments: [
      { id: "z", order: 0, alignment: 8, bytes: new Uint8Array([2]) },
      { id: "a", order: 0, alignment: 1, bytes: new Uint8Array([1]) },
    ],
    symbols: [],
    fixups: [],
  });
  assert.equal(padded.ok, true);
  if (padded.ok)
    assert.deepEqual([...padded.value.bytes], [1, 0, 0, 0, 0, 0, 0, 0, 2]);
});
test("symbolic origin and addends are explicit, not inferred from patch location", () => {
  const a = fixture();
  const f: Fixup = {
    id: "f",
    kind: "relative",
    fragment: "header",
    offset: 0,
    width: 8,
    endian: "big",
    target: { symbol: "target", addend: -1 },
    origin: { symbol: "start", addend: 4 },
  };
  const r = link({ ...a, fixups: [f] });
  assert.equal(r.ok, true);
  if (r.ok)
    assert.deepEqual(
      [...r.value.bytes.subarray(0, 8)],
      [0, 0, 0, 0, 0, 0, 0, 11],
    );
  const negative = link({
    ...a,
    fixups: [{ ...f, target: f.origin, origin: f.target }],
  });
  assert.equal(negative.ok, true);
  if (negative.ok)
    assert.deepEqual(
      [...negative.value.bytes.subarray(0, 8)],
      [255, 255, 255, 255, 255, 255, 255, 245],
    );
});
test("validates duplicates, missing references, ranges and overlap without mutating input", () => {
  const a = fixture(),
    f = a.fixups[0];
  assert.ok(f);
  const fragment = a.fragments[0],
    symbol = a.symbols[0];
  assert.ok(fragment);
  assert.ok(symbol);
  failure({ ...a, fragments: [...a.fragments, fragment] }, "DUPLICATE_ID");
  failure({ ...a, symbols: [...a.symbols, symbol] }, "DUPLICATE_ID");
  failure({ ...a, fixups: [f, f] }, "DUPLICATE_ID");
  failure(
    { ...a, symbols: [{ ...symbol, fragment: "missing" }] },
    "UNKNOWN_FRAGMENT",
  );
  failure(
    { ...a, fixups: [{ ...f, target: { symbol: "missing", addend: 0 } }] },
    "UNKNOWN_SYMBOL",
  );
  failure(
    { ...a, fixups: [{ ...f, fragment: "missing" }] },
    "UNKNOWN_FRAGMENT",
  );
  failure({ ...a, fixups: [{ ...f, offset: 15 }] }, "OUT_OF_BOUNDS");
  failure({ ...a, symbols: [{ ...symbol, offset: 3 }] }, "OUT_OF_BOUNDS");
  failure(
    { ...a, fixups: [f, { ...f, id: "overlap", offset: 4 }] },
    "OVERLAPPING_FIXUPS",
  );
  failure({ ...a, fixups: [{ ...f, width: 4 }] }, "VALUE_OUT_OF_RANGE");
  failure({ ...a, maxByteLength: 17 }, "SIZE_LIMIT");
  failure(
    { ...a, virtualBase: { lo: 0xffffffff, hi: 0xffffffff } },
    "OVERFLOW",
  );
  failure(
    { ...a, fragments: [{ ...fragment, alignment: 0 }] },
    "INVALID_INPUT",
  );
  failure(
    { ...a, fixups: [{ ...f, target: { symbol: "target", addend: 0.5 } }] },
    "INVALID_INPUT",
  );
  assert.equal(
    a.fragments.find((f) => f.id === "header")?.bytes.every((b) => b === 0),
    true,
  );
});
test("relative signed limits, one-past symbols, zero-size image and huge padding", () => {
  const a = fixture();
  const f: Fixup = {
    id: "tiny",
    kind: "relative",
    fragment: "header",
    offset: 0,
    width: 1,
    endian: "little",
    target: { symbol: "target", addend: 111 },
    origin: { symbol: "start", addend: 0 },
  };
  const r = link({ ...a, fixups: [f] });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.bytes[0], 127);
  failure(
    { ...a, fixups: [{ ...f, target: { symbol: "target", addend: 112 } }] },
    "VALUE_OUT_OF_RANGE",
  );
  const empty = link({
    ...a,
    fragments: [],
    symbols: [],
    fixups: [],
    maxByteLength: 0,
  });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.bytes.length, 0);
  const end = link({
    ...a,
    symbols: [{ id: "end", fragment: "data", offset: 2 }],
    fixups: [],
  });
  assert.equal(end.ok, true);
  failure(
    {
      ...a,
      fragments: [
        { id: "a", order: 0, alignment: 1, bytes: new Uint8Array(1) },
        {
          id: "b",
          order: 1,
          alignment: Number.MAX_SAFE_INTEGER,
          bytes: new Uint8Array(1),
        },
      ],
    },
    "SIZE_LIMIT",
  );
});
