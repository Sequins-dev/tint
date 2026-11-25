// Loop string builders natively (build-loop-strings): loops appending to a
// string local build it in a buffer, with the results of plain joins.
// tools/string-builder-fixture.test.ts runs the same source under Node.
import test from "node:test";
import { stringBuilderSource } from "./string-builder-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

test("loop string builders produce the joined pieces", () => {
  verifyHostedFixture(stringBuilderSource, "string-builder");
});
