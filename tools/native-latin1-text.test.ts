// The Latin-1 and ASCII text primitives natively, bound to their IR
// instructions (packages/foundation/src/text/latin1.ts), and the UTF-8 codec
// built on them. tools/latin1-text-fixture.test.ts runs the same source
// under Node against the portable bodies.
import test from "node:test";
import { latin1TextSource } from "./latin1-text-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

test("Latin-1 primitives and the UTF-8 codec match their portable bodies", () => {
  verifyHostedFixture(latin1TextSource, "latin1-text", [
    ["@tint/foundation/text/latin1", "packages/foundation/src/text/latin1.ts"],
    [
      "@tint/foundation/text/text-encoding",
      "packages/foundation/src/text/text-encoding/index.ts",
    ],
  ]);
});
