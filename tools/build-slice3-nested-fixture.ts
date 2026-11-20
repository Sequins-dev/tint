import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { createHostedSourceValidator } from "./source-validation.ts";
import {
  nestedCaptureSource,
  nestedContractSource,
  nestedIterationSource,
} from "./slice3-nested-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("nested bridge fixture requires TINT_BUILD_ONLY=1");
for (const item of [
  { source: nestedCaptureSource, name: "slice3-nested-captures" },
  { source: nestedContractSource, name: "slice3-nested-contract" },
  { source: nestedIterationSource, name: "slice3-nested-iterations" },
]) {
  if (process.argv[2] !== undefined && process.argv[2] !== item.name) continue;
  const image = verifyHostedFixture(item.source, item.name, [], [], [], [], {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    validateSource: createHostedSourceValidator([
      { id: "fixture", text: item.source },
    ]),
    functionFallback: true,
  });
  const manifest = JSON.parse(readFileSync(image + ".manifest.json", "utf8"));
  assert.equal(manifest.fallbackFunctions?.[0]?.name, "general");
  assert.equal(manifest.fallbackFunctions?.length, 1);
}
