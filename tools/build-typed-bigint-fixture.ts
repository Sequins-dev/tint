import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  typedBigIntDowncastSource,
  typedBigIntSource,
} from "./typed-bigint-fixture-source.ts";
// Typed BigInt arithmetic, comparisons, conversions and errors on the typed
// path (docs/unified-pipeline.md, slice 4a).
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed BigInt fixture requires TINT_BUILD_ONLY=1");
// The general fallback would hide a typed lowering failure.
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(verifyHostedFixture(typedBigIntSource, "typed-bigint-v1"));
console.log(
  verifyHostedFixture(typedBigIntDowncastSource, "typed-bigint-downcast-v1"),
);
