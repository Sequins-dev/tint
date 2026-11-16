import assert from "node:assert/strict";
import test from "node:test";
import { placeRecordFields, verify } from "@tint/ir/scalar";

test("placement packs payload words first and one-byte tags after them", () => {
  const layout = placeRecordFields([
    { type: "optional-number", mutable: true, optional: true },
    { type: "number", mutable: false, optional: false },
    { type: "optional-boolean", mutable: true, optional: true },
    { type: "reference", mutable: true, optional: false, initialized: true },
  ]);
  assert.deepEqual(layout, {
    byteLength: 56,
    fields: [
      {
        type: "optional-number",
        mutable: true,
        offset: 8,
        presenceOffset: 48,
      },
      { type: "number", mutable: false, offset: 16 },
      {
        type: "optional-boolean",
        mutable: true,
        offset: 24,
        presenceOffset: 49,
      },
      { type: "reference", mutable: true, offset: 40, stateOffset: 50 },
    ],
  });
  assert.deepEqual(verify({ records: [layout], functions: [] }), { ok: true });
  // Eight optional words and their tags: 8 + 64 + 8 = 80 bytes on the
  // 8-byte granule, where a presence word per field took 16 + 128.
  const optional = placeRecordFields(
    Array.from({ length: 8 }, () => ({
      type: "optional-reference" as const,
      mutable: true,
      optional: true,
    })),
  );
  assert.equal(optional.byteLength, 80);
  assert.deepEqual(
    optional.fields.map((field) => field.presenceOffset),
    [72, 73, 74, 75, 76, 77, 78, 79],
  );
  // A target header and granule move every offset and the extent.
  assert.deepEqual(
    placeRecordFields(
      [{ type: "optional-string", mutable: true, optional: true }],
      16,
      16,
    ),
    {
      byteLength: 32,
      fields: [
        {
          type: "optional-string",
          mutable: true,
          offset: 16,
          presenceOffset: 24,
        },
      ],
    },
  );
});
