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
    byteLength: 64,
    fields: [
      {
        type: "optional-number",
        mutable: true,
        offset: 16,
        presenceOffset: 56,
      },
      { type: "number", mutable: false, offset: 24 },
      {
        type: "optional-boolean",
        mutable: true,
        offset: 32,
        presenceOffset: 57,
      },
      { type: "reference", mutable: true, offset: 48, stateOffset: 58 },
    ],
  });
  assert.deepEqual(verify({ records: [layout], functions: [] }), { ok: true });
  // Eight optional words and their tags: 16 + 64 + 8 rounds to 96, where a
  // presence word per field took 16 + 128.
  const optional = placeRecordFields(
    Array.from({ length: 8 }, () => ({
      type: "optional-reference" as const,
      mutable: true,
      optional: true,
    })),
  );
  assert.equal(optional.byteLength, 96);
  assert.deepEqual(
    optional.fields.map((field) => field.presenceOffset),
    [80, 81, 82, 83, 84, 85, 86, 87],
  );
  // A target header and granule move every offset and the extent.
  assert.deepEqual(
    placeRecordFields(
      [{ type: "optional-string", mutable: true, optional: true }],
      8,
      8,
    ),
    {
      byteLength: 24,
      fields: [
        {
          type: "optional-string",
          mutable: true,
          offset: 8,
          presenceOffset: 16,
        },
      ],
    },
  );
});
