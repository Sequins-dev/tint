// Usage: node compare-ledger.mjs <ledger-full.jsonl> <report.json>...; cached outcome vs ledger current evidence per (path, variant, sha256).
import { readFileSync } from "node:fs";
const [table, ...reports] = process.argv.slice(2);
const ledger = new Map();
for (const line of readFileSync(table, "utf8").split("\n")) {
  if (!line) continue;
  const row = JSON.parse(line);
  ledger.set(row.path + "#" + row.variant, row);
}
const summary = [], differences = [];
for (const file of reports) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  let identical = 0;
  for (const o of report.observations) {
    const row = ledger.get(o.path + "#" + o.variant);
    const entry = { variant: o.path + "#" + o.variant, cached: o.status, ledger: row?.status ?? "missing", ledgerReport: row?.report, sourceMatches: row?.sha256 === o.sha256 };
    if (row === undefined || row.sha256 !== o.sha256 || row.status !== o.status) differences.push({ report: file.split("/").pop(), ...entry, cachedOutcome: o.outcome });
    else identical++;
  }
  summary.push({ report: file.split("/").pop(), compared: report.observations.length, identical, totals: report.totals });
}
console.log(JSON.stringify({ kind: "stage4-cached-vs-ledger-differential", ledgerTable: table, differences: differences.length, summary, details: differences }, null, 2));
