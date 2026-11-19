import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  errorProducerSource,
  mixedRealmErrorViewsSource,
} from "./mixed-realm-error-views-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("mixed error views fixture requires TINT_BUILD_ONLY=1");

const trusted = "fixture:trusted";
const parsed = parseModule(createSourceTextView(errorProducerSource));
assert.ok(parsed.ok, JSON.stringify(parsed));
let partition: readonly string[] | undefined;
const path = verifyHostedFixture(
  mixedRealmErrorViewsSource.replace(
    "checkContract = false",
    "checkContract = true",
  ),
  "mixed-realm-error-views",
  [["./trusted.ts", trusted]],
  [{ id: trusted, module: parsed.value, dependencies: new Map() }],
  [],
  [{ module: trusted, namespace: "trusted-error-views", retainedExports: [] }],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      partition = modules;
    },
  },
);
assert.deepEqual(partition, ["fixture"]);
console.log(path);
