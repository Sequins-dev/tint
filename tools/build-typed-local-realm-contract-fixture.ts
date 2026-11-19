// Explicit element and field contracts are observable even through a wider
// alias. JavaScript permits these writes after TypeScript erases the types.
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed local realm contract fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(
  `
export function run(): number {
  const groups: Record<string, number[]> = { group: [42] };
  const input: unknown = groups;
  const wide = input as Record<string, unknown[]>;
  const values = wide.group;
  if (values === undefined) return 1;
  try {
    values[0] = "bad";
    return 2;
  } catch (error) {}
  if (values[0] !== 42 || values.length !== 1) return 3;
  try {
    values.push(17, "bad");
    return 4;
  } catch (error) {}
  if (values[0] !== 42 || values[1] !== 17 || values.length !== 2) return 5;
  const records: Record<string, { value: number }> = { record: { value: 42 } };
  const erased: unknown = records;
  const broad = erased as Record<string, { value: unknown }>;
  const record = broad.record;
  if (record === undefined) return 6;
  try {
    record.value = false;
    return 7;
  } catch (error) {}
  if (record.value !== 42) return 8;
  return 42;
}
`,
  "typed-local-realm-contract",
);
