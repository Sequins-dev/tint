/**
 * Writes a new immutable inventory refreshed from a base inventory. See
 * tools/test262-inventory-refresh.ts for the verification and selection policy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  fileEvidence,
  refreshInventory,
  type Inventory,
} from "./test262-inventory-refresh.ts";

function main(args: readonly string[]): void {
  const usage =
    "usage: node tools/refresh-test262-inventory.ts <base.json> <out.json> <test262-checkout> <selection=report.json:journal.jsonl>...";
  const [baseName, outName, checkout, ...pairs] = args;
  if (!baseName || !outName || !checkout || pairs.length === 0)
    throw new Error(usage);
  const replacements = pairs.map((pair) => {
    const match = /^([^=]+)=([^:]+):(.+)$/.exec(pair);
    if (!match) throw new Error(usage);
    return { selection: match[1]!, report: match[2]!, journal: match[3]! };
  });
  const results = "docs/results";
  const base = JSON.parse(
    readFileSync(join(results, basename(baseName)), "utf8"),
  ) as Inventory;
  const next = refreshInventory(base, fileEvidence(".", results, checkout), {
    baseName: basename(baseName),
    generatedAt: new Date().toISOString(),
    replacements,
  });
  writeFileSync(
    join(results, basename(outName)),
    JSON.stringify(next, null, 2) + "\n",
    {
      flag: "wx",
    },
  );
}

main(process.argv.slice(2));
