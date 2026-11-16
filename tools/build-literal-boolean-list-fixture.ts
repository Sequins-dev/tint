import { verifyHostedFixture } from "./hosted-fixture.ts";
// Lists whose element is a boolean literal (compact key-index values of a
// KeyIndex<K, true>) share the boolean list encoding with boolean[] and
// optional literal lists, through the typed path (no general fallback).
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("literal boolean list fixture requires TINT_BUILD_ONLY=1");
// The general fallback would hide a typed lowering failure.
process.env.TINT_GENERAL_FALLBACK = "0";
verifyHostedFixture(
  `export function run():number {
  const marks: true[] = [];
  marks.push(true);
  marks.push(true);
  const flags: boolean[] = [false, true];
  const maybe: (true | undefined)[] = [undefined, true];
  let score = 0;
  if (marks.length === 2) score += 1;
  if (marks[0] === true) score += 2;
  if (marks[1] === true) score += 4;
  if (flags[0] === false && flags[1] === true) score += 8;
  if (maybe[0] === undefined && maybe[1] === true) score += 16;
  marks[0] = true;
  marks.length = 1;
  if (marks.length === 1 && marks[0] === true) score += 11;
  return score;
}
`,
  "literal-boolean-list-v1",
);
