import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedRealmErrorsSource } from "./typed-realm-errors-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed error fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(
  verifyHostedFixture(typedRealmErrorsSource, "typed-realm-errors-v1"),
);
