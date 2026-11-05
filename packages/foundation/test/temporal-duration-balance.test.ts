import assert from "node:assert/strict";
import test from "node:test";
import { parseInteger } from "@tint/foundation/numeric/big-integer";
import * as durations from "../src/chrono/temporal-duration/index.ts";
test("time balancing divides exact integers before rounding each Number field", () => {
  const units = [
    3600000000000n,
    60000000000n,
    1000000000n,
    1000000n,
    1000n,
    1n,
  ];
  for (const total of [
    0n,
    1n,
    -1n,
    3661002003004n,
    -3661002003004n,
    18446744073709551616n,
    -17280000000000000000000n,
  ]) {
    for (let largest = 0; largest < 6; largest++) {
      const integer = parseInteger(String(total), 10)!;
      const result = durations.balanceTimeDuration(integer, largest)!;
      let remaining = total;
      const expected = [0, 0, 0, 0];
      for (let i = 0; i < 6; i++) {
        const divisor = units[i]!;
        expected.push(i < largest ? 0 : Number(remaining / divisor));
        if (i >= largest) remaining %= divisor;
      }
      assert.deepEqual(durations.durationFields(result), expected);
    }
  }
  assert.equal(
    durations.balanceTimeDuration(parseInteger("1", 10)!, -1),
    undefined,
  );
  assert.equal(
    durations.balanceTimeDuration(parseInteger("1", 10)!, 6),
    undefined,
  );
});
