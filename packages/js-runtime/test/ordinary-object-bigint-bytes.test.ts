import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInteger,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";
import { createBigIntValue } from "../src/objects/bigints.ts";
import * as codec from "../src/objects/bigint-bytes.ts";

test("BigInt byte codecs preserve signed limits and truncate modulo 64 bits", () => {
  for (const input of [
    0n,
    1n,
    -1n,
    2n ** 63n - 1n,
    2n ** 63n,
    -(2n ** 63n),
    2n ** 64n - 1n,
    2n ** 128n + 42n,
    -(2n ** 128n) - 42n,
  ])
    for (const little of [false, true]) {
      const integer = parseInteger(String(input), 10);
      assert.ok(integer);
      const data = new Uint8Array(8),
        expected = new Uint8Array(8),
        view = new DataView(expected.buffer);
      view.setBigUint64(0, input, little);
      codec.writeBigIntBytes(
        data,
        0,
        createBigIntValue(integer),
        little ? "little" : "big",
      );
      assert.deepEqual(data, expected);
      for (const signed of [false, true]) {
        const decoded = codec.readBigIntBytes(
          data,
          0,
          little ? "little" : "big",
          signed,
        );
        assert.equal(
          formatInteger(decoded.integer, 10),
          String(
            signed ? view.getBigInt64(0, little) : view.getBigUint64(0, little),
          ),
        );
      }
    }
});
