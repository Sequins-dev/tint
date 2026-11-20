import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  realmInstanceofDriverSource,
  typedRealmInstanceofSource,
} from "./typed-realm-instanceof-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed realm instanceof fixture requires TINT_BUILD_ONLY=1");

const trusted = "fixture:trusted";
const parsed = parseModule(createSourceTextView(typedRealmInstanceofSource));
assert.ok(parsed.ok, JSON.stringify(parsed));
let partition: readonly string[] | undefined;
verifyHostedFixture(
  realmInstanceofDriverSource,
  "typed-realm-instanceof",
  [["./trusted.ts", trusted]],
  [{ id: trusted, module: parsed.value, dependencies: new Map() }],
  [],
  [
    {
      module: trusted,
      namespace: "trusted-realm-instanceof",
      retainedExports: [],
    },
  ],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      partition = modules;
    },
  },
);
assert.deepEqual(partition, ["fixture"]);
