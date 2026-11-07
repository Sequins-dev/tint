import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";
import { classAutoAccessorCases } from "./class-auto-accessor-cases.ts";

for (const [name, source] of classAutoAccessorCases)
  test(name, () => {
    assert.equal(createLoweredRealm().run(source), "none");
  });
