// ToInt32, ToUint32 and ToUint16 of unproven doubles natively: bitwise
// operators and String.fromCharCode over fractional, negative, non-finite
// and boundary operands (tools/verify-hosted-bitwise-integral.ts).
import test from "node:test";

test("bitwise operators and code units convert unproven doubles like Node", async () => {
  // The fixture must compile on the typed path, not the general fallback
  // (the builder reads this when it is imported).
  process.env.TINT_GENERAL_FALLBACK = "0";
  await import("./verify-hosted-bitwise-integral.ts");
});
