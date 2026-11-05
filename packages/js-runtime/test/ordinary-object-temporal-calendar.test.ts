import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTemporalCalendar } from "../src/objects/temporal-coercion.ts";
import {
  createErrorRealm,
  createObject,
  type ObjectHooks,
  type ScriptPropertyKey,
} from "../src/objects/index.ts";
test("calendar identifier validation is separate from algorithm availability", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  assert.equal(canonicalTemporalCalendar(undefined, realm), "iso8601");
  assert.equal(canonicalTemporalCalendar("ISO8601", realm), "iso8601");
  assert.equal(canonicalTemporalCalendar("HEBREW", realm), "hebrew");
  assert.equal(canonicalTemporalCalendar("gregory", realm), "gregory");
});
