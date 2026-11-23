import assert from "node:assert/strict";
import test from "node:test";
import { extendRecordLayout, placeRecordFields, verify } from "@tint/ir/scalar";

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

test("deferred fields carry no tag and may be omitted at construction", () => {
  const layout = placeRecordFields([
    { type: "number", mutable: true, optional: false, deferred: true },
    { type: "reference", mutable: true, optional: false },
  ]);
  assert.deepEqual(layout.fields[0], {
    type: "number",
    mutable: true,
    offset: 8,
    deferred: true,
  });
  const span = { start: 0, end: 0 };
  function construct(omitted: number) {
    return verify({
      records: [layout],
      functions: [
        {
          id: 0,
          name: "make",
          exported: true,
          parameters: [0],
          slots: ["reference"],
          returnType: "reference",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "constant", id: 1, value: 1, ...span },
                {
                  kind: "record-new",
                  id: 2,
                  record: 0,
                  arguments: omitted === 0 ? [undefined, 0] : [1, undefined],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 2, ...span },
            },
          ],
        },
      ],
    });
  }
  assert.deepEqual(construct(0), { ok: true });
  const required = construct(1);
  assert.ok(!required.ok);
  assert.match(
    required.error.message,
    /required record field cannot be omitted/,
  );
  assert.throws(
    () =>
      placeRecordFields([
        { type: "number", mutable: true, optional: true, deferred: true },
      ]),
    /deferred record fields carry no tag/,
  );
});

test("extended layouts keep the base layout as a prefix", () => {
  const base = placeRecordFields([
    { type: "number", mutable: true, optional: false },
    { type: "optional-reference", mutable: true, optional: true },
    { type: "reference", mutable: false, optional: false },
  ]);
  const derived = extendRecordLayout(base, [
    { type: "boolean", mutable: true, optional: false },
    { type: "string", mutable: true, optional: true },
  ]);
  assert.deepEqual(derived.fields.slice(0, base.fields.length), base.fields);
  const own = derived.fields.slice(base.fields.length);
  assert.ok(own.every((field) => field.offset >= base.byteLength));
  assert.ok(
    (own[1]?.presenceOffset ?? 0) >= base.byteLength &&
      (own[1]?.presenceOffset ?? 0) < derived.byteLength,
  );
  assert.equal(derived.byteLength % 8, 0);
});
