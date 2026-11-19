import { verifyHostedFixture } from "./hosted-fixture.ts";

// Tint enforces assertions from unknown at runtime and does not capture a
// stack for its native-only Error values. Neither behavior is a Node oracle.
const source = `function checked(value: unknown): Error {
  let slot: Error = new Error("initial");
  slot = value as Error;
  return slot;
}
export function run(): number {
  const error = new Error("original");
  if (error.stack !== undefined || checked(error) !== error) return 1;
  const range = new RangeError("range");
  if (checked(range) !== range || checked(range).message !== "range") return 2;
  let rejected = false;
  try { checked(42); }
  catch (e) {
    if (!(e instanceof TypeError)) return 3;
    rejected = e.message === "value does not match the asserted type";
  }
  if (!rejected) return 4;
  const structural: Error = { name: "Custom", message: "text" };
  if (structural instanceof Error || structural.name !== "Custom" ||
      structural.message !== "text" || structural.stack !== undefined) return 5;
  const given = { name: "Custom", message: "text", stack: "trace" };
  if (checked(given) !== given || checked(given).stack !== "trace") return 6;
  try { checked({ name: "Custom", message: 12 }); return 7; }
  catch (e) { if (!(e instanceof TypeError)) return 8; }
  return 42;
}`;

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("native error contracts fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
console.log(verifyHostedFixture(source, "typed-realm-error-contracts-v1"));
