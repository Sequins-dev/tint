import { verifyHostedFixture } from "./hosted-fixture.ts";
import { typedDynamicObjectSource } from "./typed-dynamic-object-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed dynamic object fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(typedDynamicObjectSource, "typed-dynamic-object-c1");
