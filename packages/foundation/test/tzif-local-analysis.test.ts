import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  createTzifZone,
  analyzeTzifLocalSeconds,
} from "../src/chrono/tzif/index.ts";

test(
  "local analysis exposes every overlap candidate and the actual gap transition",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const overlap = analyzeTzifLocalSeconds(
      model.value,
      Date.UTC(2024, 10, 3, 1, 30) / 1000,
    );
    assert.deepEqual(overlap, {
      ok: true,
      candidates: [
        Date.UTC(2024, 10, 3, 5, 30) / 1000,
        Date.UTC(2024, 10, 3, 6, 30) / 1000,
      ],
      gap: undefined,
    });
    const gap = analyzeTzifLocalSeconds(
      model.value,
      Date.UTC(2024, 2, 10, 2, 30) / 1000,
    );
    assert.deepEqual(gap, {
      ok: true,
      candidates: [],
      gap: {
        transitionEpochSeconds: Date.UTC(2024, 2, 10, 7) / 1000,
        earlierEpochSeconds: Date.UTC(2024, 2, 10, 6, 30) / 1000,
        laterEpochSeconds: Date.UTC(2024, 2, 10, 7, 30) / 1000,
      },
    });
    assert.deepEqual(analyzeTzifLocalSeconds(model.value, NaN), {
      ok: false,
      error: "invalid",
    });
  },
);

test(
  "boundary local analysis can reject a candidate by caller bounds without losing zone data",
  { skip: !existsSync("/usr/share/zoneinfo/America/New_York") },
  () => {
    const model = createTzifZone(
      new Uint8Array(readFileSync("/usr/share/zoneinfo/America/New_York")),
    );
    assert.ok(model.ok);
    const result = analyzeTzifLocalSeconds(
      model.value,
      100000001 * 86400 + 86399,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.candidates.length, 1);
  },
);
