import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedNarrowingSource } from "./typed-narrowing-fixture-source.ts";
// Assignment narrowing and `??=` on optional records on the typed path.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed narrowing fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(verifyHostedFixture(typedNarrowingSource, "typed-narrowing-v1"));
