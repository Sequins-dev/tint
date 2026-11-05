import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildImportFixups,
  type ImportRequest,
} from "@tint/image/darwin/dyld-fixups";
const request = (count = 2): ImportRequest => ({
  imports: Array.from({ length: count }, (_, i) => ({
    name: `_symbol${i}`,
    libraryOrdinal: 1,
  })),
  segmentOffset: 16384,
  segmentIndex: 2,
  segmentCount: 4,
  maxByteLength: 1024 * 1024,
});
function inspect(input: ImportRequest) {
  const result = buildImportFixups(input);
  assert.equal(result.ok, true);
  return result.value;
}
test("serializes eager imports and independent page-bounded pointer chains", () => {
  for (const count of [0, 1, 2, 2048, 2049, 4097]) {
    const input = request(count),
      { metadata, slots } = inspect(input),
      m = new DataView(metadata.buffer),
      s = new DataView(slots.buffer);
    assert.equal(slots.length, count * 8);
    assert.equal(m.getUint32(0, true), 0);
    assert.equal(m.getUint32(16, true), count);
    assert.equal(m.getUint32(20, true), 1);
    const starts = m.getUint32(4, true),
      imports = m.getUint32(8, true),
      names = m.getUint32(12, true);
    assert.equal(m.getUint32(starts, true), 4);
    for (const index of [0, 1, 3])
      assert.equal(m.getUint32(starts + 4 + index * 4, true), 0);
    if (!count) {
      assert.equal(m.getUint32(starts + 12, true), 0);
      continue;
    }
    const seg = starts + m.getUint32(starts + 12, true),
      pages = Math.ceil((count * 8) / 16384);
    assert.equal(m.getUint16(seg + 4, true), 16384);
    assert.equal(m.getUint16(seg + 6, true), 6);
    assert.equal(m.getBigUint64(seg + 8, true), 16384n);
    assert.equal(m.getUint16(seg + 20, true), pages);
    for (let page = 0; page < pages; page++) {
      let offset = page * 16384 + m.getUint16(seg + 22 + page * 2, true);
      for (;;) {
        const pointer = s.getBigUint64(offset, true);
        assert.equal(pointer >> 63n, 1n);
        const ordinal = Number(pointer & 0xffffffn);
        assert.equal(ordinal, offset / 8);
        const row = m.getUint32(imports + ordinal * 4, true);
        assert.equal(row & 0x1ff, 1);
        const nameStart = names + (row >>> 9),
          end = metadata.indexOf(0, nameStart);
        assert.equal(
          new TextDecoder().decode(metadata.subarray(nameStart, end)),
          input.imports[ordinal]?.name,
        );
        const next = Number((pointer >> 51n) & 0xfffn) * 4;
        if (next === 0) {
          assert.equal(offset, Math.min((page + 1) * 16384, count * 8) - 8);
          break;
        }
        assert.equal(next, 8);
        offset += next;
        assert.equal(Math.floor(offset / 16384), page);
      }
    }
  }
});
test("rejects invalid import identities, segment metadata and budgets", () => {
  const base = request();
  for (const input of [
    { ...base, segmentOffset: 1 },
    { ...base, segmentIndex: 4 },
    { ...base, segmentCount: 0 },
    { ...base, segmentOffset: NaN },
    { ...base, imports: [{ name: "bad\0name", libraryOrdinal: 1 }] },
    { ...base, imports: [{ name: "", libraryOrdinal: 1 }] },
    { ...base, imports: [{ name: "_x", libraryOrdinal: 254 }] },
    { ...base, imports: [{ name: "_x", libraryOrdinal: 0 }] },
    {
      ...base,
      imports: [
        { name: "_x", libraryOrdinal: 1 },
        { name: "_x", libraryOrdinal: 1 },
      ],
    },
    { ...base, maxByteLength: 1 },
  ])
    assert.equal(buildImportFixups(input).ok, false);
});
test("output is deterministic, budgeted, and owned", () => {
  const input = request(),
    before = JSON.stringify(input),
    a = inspect(input),
    b = inspect(input);
  assert.deepEqual(a, b);
  assert.equal(
    buildImportFixups({
      ...input,
      maxByteLength: a.metadata.length + a.slots.length,
    }).ok,
    true,
  );
  assert.equal(
    buildImportFixups({
      ...input,
      maxByteLength: a.metadata.length + a.slots.length - 1,
    }).ok,
    false,
  );
  a.slots.fill(0);
  assert.deepEqual(inspect(input), b);
  assert.equal(JSON.stringify(input), before);
});

test("library ordinals stop before the reserved signed-special range", () => {
  for (const libraryOrdinal of [1, 127, 128, 240])
    assert.equal(
      buildImportFixups({
        ...request(),
        imports: [{ name: "_x", libraryOrdinal }],
      }).ok,
      true,
    );
  for (const libraryOrdinal of [241, 253, 254, 255, -1])
    assert.deepEqual(
      buildImportFixups({
        ...request(),
        imports: [{ name: "_x", libraryOrdinal }],
      }),
      { ok: false, error: "INVALID_IMPORT" },
    );
});
