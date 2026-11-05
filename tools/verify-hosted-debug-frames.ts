import { verifyHostedFixture } from "./hosted-fixture.ts";

// Build with TINT_DEBUG_SYMBOLS=1. Inspect the ABI-owned pointer homes at inspect.
verifyHostedFixture(
  `export function inspect(value:number):number{return value+23;}
   export function run():number{return inspect(19);}`,
  "debug-frames",
);
