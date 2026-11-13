// Compare two code size reports (TINT_CODE_SIZE=1 / --code-size builds):
//   node tools/code-size/compare.ts <base.code-size.json> <head.code-size.json>
//        [--top N] [--exact] [--max-growth <bytes>] [--max-growth-percent <p>]
// Prints module totals and the functions that grew or shrank. With a growth
// limit, exits 1 when the total grows beyond it (a size-regression gate).
import { readFileSync } from "node:fs";
import {
  compareCodeSize,
  formatCodeSizeComparison,
  type CodeSizeReport,
} from "./report.ts";

const argv = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
}
const files = argv.filter(
  (arg, i) => !arg.startsWith("--") && !argv[i - 1]?.match(/^--(top|max-)/),
);
const [basePath, headPath] = files;
if (basePath === undefined || headPath === undefined || files.length !== 2) {
  process.stderr.write(
    "usage: compare.ts <base.code-size.json> <head.code-size.json> [--top N] [--exact] [--max-growth bytes] [--max-growth-percent p]\n",
  );
  process.exit(64);
}
function load(path: string): CodeSizeReport {
  const report = JSON.parse(readFileSync(path, "utf8")) as CodeSizeReport;
  if (report.kind !== "tint-code-size" || report.version !== 1)
    throw Error(path + " is not a tint code size report");
  return report;
}
const comparison = compareCodeSize(
  load(basePath),
  load(headPath),
  argv.includes("--exact"),
);
process.stdout.write(
  formatCodeSizeComparison(comparison, Number(option("--top") ?? "20")),
);
const growth = comparison.head - comparison.base,
  maxGrowth = option("--max-growth"),
  maxPercent = option("--max-growth-percent");
if (
  (maxGrowth !== undefined && growth > Number(maxGrowth)) ||
  (maxPercent !== undefined &&
    comparison.base > 0 &&
    (growth / comparison.base) * 100 > Number(maxPercent))
) {
  process.stderr.write(`code size grew by ${growth} bytes: over the limit\n`);
  process.exit(1);
}
