import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import { canonicalCalendarIdentifier } from "calendar";
export function run(): number {
  for (const pair of [
    ["islamicc", "islamic-civil"], ["ISLAMICC", "islamic-civil"],
    ["ethiopic-amete-alem", "ethioaa"], ["ETHIOPIC-AMETE-ALEM", "ethioaa"],
    ["ISO8601", "iso8601"], ["GREGORY", "gregory"],
    ["buddhist", "buddhist"], ["chinese", "chinese"], ["dangi", "dangi"],
    ["coptic", "coptic"], ["ethiopic", "ethiopic"], ["hebrew", "hebrew"],
    ["indian", "indian"], ["japanese", "japanese"], ["persian", "persian"],
    ["roc", "roc"], ["islamic-tbla", "islamic-tbla"],
    ["islamic-rgsa", "islamic-rgsa"], ["islamic-umalqura", "islamic-umalqura"]
  ]) {
    if (pair === undefined) return 1;
    const source = pair[0], expected = pair[1];
    if (source === undefined || expected === undefined) return 1;
    if (canonicalCalendarIdentifier(source) !== expected) return 2;
  }
  for (const invalid of ["", " islamicc", "islamicc ", "islamicc-x", "gregorian", "gregory,hebrew", "ＩＳＯ８６０１"]) {
    if (invalid === undefined) return 3;
    if (canonicalCalendarIdentifier(invalid) !== undefined) return 4;
  }
  return 42;
}`,
  "calendar-identifiers",
  [["calendar", "packages/js-runtime/src/objects/calendar.ts"]],
);
