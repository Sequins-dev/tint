import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedLocalRealmSource } from "./typed-local-realm-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed local realm fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(typedLocalRealmSource, "typed-local-realm");
