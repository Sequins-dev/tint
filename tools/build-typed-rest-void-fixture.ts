import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  typedRestSource,
  typedVoidSource,
} from "./typed-rest-void-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed rest and void fixtures require TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(verifyHostedFixture(typedRestSource, "typed-rest-v1"));
console.log(verifyHostedFixture(typedVoidSource, "typed-void-v1"));
