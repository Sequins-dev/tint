import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedGeneralTypeofSource } from "./typed-general-typeof-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed typeof fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(
  verifyHostedFixture(typedGeneralTypeofSource, "typed-general-typeof"),
);
