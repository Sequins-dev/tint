import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  typedBindingContractSource,
  typedBindingPatternsSource,
  tintBindingPatternProviders,
  typedRealmBindingPatternsSource,
} from "./typed-binding-patterns-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed binding patterns fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(
  verifyHostedFixture(typedBindingPatternsSource, "typed-binding-patterns-v1"),
);
console.log(
  verifyHostedFixture(typedBindingContractSource, "typed-binding-contract-v1"),
);

const provider = parseModule(createSourceTextView(tintBindingPatternProviders));
assert.ok(provider.ok, JSON.stringify(provider));
const objects = "packages/js-runtime/src/objects/index.ts";
console.log(
  verifyHostedFixture(
    typedRealmBindingPatternsSource, "typed-realm-binding-patterns-v1",
    [["./providers.ts", "fixture:binding-providers"], ["@tint/js-runtime/objects", objects]],
    [{
      id: "fixture:binding-providers", module: provider.value,
      dependencies: new Map([["@tint/js-runtime/objects", objects]]),
    }],
  ),
);
