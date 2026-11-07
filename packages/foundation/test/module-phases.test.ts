import assert from "node:assert/strict";
import test from "node:test";
import { canonicalModuleRequest, moduleRequestsEqual } from "../src/modules.ts";
test("source and evaluation requests preserve phase while sharing canonical attribute order", () => {
  const request = {
    specifier: "m",
    attributes: [
      { key: "z", value: "2" },
      { key: "a", value: "1" },
    ],
  };
  const source = canonicalModuleRequest({ ...request, phase: "source" });
  assert.deepEqual(source, {
    specifier: "m",
    attributes: [
      { key: "a", value: "1" },
      { key: "z", value: "2" },
    ],
    phase: "source",
  });
  assert.equal(
    moduleRequestsEqual(source, canonicalModuleRequest(request)),
    false,
  );
  assert.equal(
    moduleRequestsEqual(
      source,
      canonicalModuleRequest({ ...request, phase: "source" }),
    ),
    true,
  );
});

test("loaded-resource keys ignore phase while static request identity retains it", async () => {
  const modules = await import("../src/modules.ts");
  const evaluation = { specifier: "m", attributes: [] };
  const deferred = { ...evaluation, phase: "defer" as const };
  assert.equal(modules.moduleRequestKeysEqual(evaluation, deferred), true);
  assert.equal(modules.moduleRequestsEqual(evaluation, deferred), false);
});
