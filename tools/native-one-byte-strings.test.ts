// One-byte and two-byte string kinds natively (docs/design-one-byte-strings.md):
// code-unit semantics across both kinds, their 0xFF/0x100 boundary,
// surrogates, narrowing slices, widening concatenation and joins, and
// literal comparisons. tools/one-byte-strings-fixture.test.ts runs the same
// source under Node.
import test from "node:test";
import { oneByteStringsSource } from "./one-byte-strings-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

test("strings keep code-unit semantics in both kinds", () => {
  verifyHostedFixture(oneByteStringsSource, "one-byte-strings");
});
