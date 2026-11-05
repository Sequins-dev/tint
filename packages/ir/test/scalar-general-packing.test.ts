import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ScalarType, type ModuleIR } from "../src/scalar/index.ts";
const span = { start: 0, end: 0 };
for (const type of [
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Float64Array",
] as const) {
  test(`general values can retain a concrete ${type} reference`, () => {
    const module: ModuleIR = {
      functions: [
        {
          id: 0,
          name: "retain",
          exported: true,
          parameters: [0],
          slots: [type],
          returnType: "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                { kind: "general-wrap", id: 1, value: 0, ...span },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
      ],
    };
    const result = verify(module);
    assert.ok(result.ok, JSON.stringify(result));
    for (const rejected of [
      "general",
      "optional-reference",
      "optional-string",
      "optional-number",
    ] as const satisfies readonly ScalarType[]) {
      assert.equal(
        verify({
          ...module,
          functions: module.functions.map((fn) => ({
            ...fn,
            slots: [rejected],
          })),
        }).ok,
        false,
      );
    }
  });
}
