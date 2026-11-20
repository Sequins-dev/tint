import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  typedRealmAggregateFlow,
  typedRealmOperations,
  typedVoidCallbackResults,
} from "./typed-realm-operations-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed realm operations fixtures require TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";

verifyHostedFixture(typedRealmOperations, "typed-realm-operations");
verifyHostedFixture(typedRealmAggregateFlow, "typed-realm-aggregate-flow");
verifyHostedFixture(typedVoidCallbackResults, "typed-void-callback-results");
