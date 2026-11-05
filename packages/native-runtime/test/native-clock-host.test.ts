import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monotonicMilliseconds,
  wallClockMilliseconds,
} from "../src/intrinsics/clock.ts";
test("clock leaf requires explicit native host authorization", () =>
  assert.throws(monotonicMilliseconds));

test("wall clock also requires explicit native host authorization", () =>
  assert.throws(wallClockMilliseconds));
