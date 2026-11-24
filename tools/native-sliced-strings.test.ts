// Sliced strings natively (docs/design-one-byte-strings.md): every string
// operation reads slices like the flat strings they equal, and collections
// move their parents. tools/sliced-strings-fixture.test.ts runs the same
// source under Node.
import test from "node:test";
import { slicedStringsSource } from "./sliced-strings-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

test("sliced strings read like flat strings and keep their parents", () => {
  verifyHostedFixture(slicedStringsSource, "sliced-strings", [
    ["@tint/foundation/text/latin1", "packages/foundation/src/text/latin1.ts"],
    [
      "@tint/foundation/text/text-encoding",
      "packages/foundation/src/text/text-encoding/index.ts",
    ],
  ]);
});
