// The UTF-8 bulk primitives natively, bound to their IR instructions
// (packages/foundation/src/text/utf8.ts). tools/utf8-text-fixture.test.ts
// runs the same source under Node against the portable bodies.
import test from "node:test";
import { utf8TextSource } from "./utf8-text-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

test("UTF-8 primitives match their portable bodies", () => {
  verifyHostedFixture(utf8TextSource, "utf8-text", [
    ["@tint/foundation/text/utf8", "packages/foundation/src/text/utf8.ts"],
  ]);
});
