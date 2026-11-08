// Usage: node compare-diff.mjs <on.json> <off.json> [...more on/off pairs]; compares canonical per-variant outcomes.
import { readFileSync } from "node:fs";
const args = process.argv.slice(2), summary = [];
let differences = 0;
for (let i = 0; i < args.length; i += 2) {
  const load = (file) => JSON.parse(readFileSync(file, "utf8"));
  const on = load(args[i]), off = load(args[i + 1]);
  if (on.variantSubsetSha256 !== off.variantSubsetSha256) throw Error("variant subsets differ " + args[i]);
  const key = (o) => o.path + "#" + o.variant + "#" + o.sha256;
  const canon = (o) => JSON.stringify({ status: o.status, outcome: o.outcome });
  const offMap = new Map(off.observations.map((o) => [key(o), canon(o)]));
  const diffs = [];
  for (const o of on.observations) {
    const other = offMap.get(key(o));
    if (other === undefined) diffs.push({ variant: key(o), on: canon(o), off: "missing" });
    else if (other !== canon(o)) diffs.push({ variant: key(o), on: canon(o), off: other });
    offMap.delete(key(o));
  }
  for (const [k, v] of offMap) diffs.push({ variant: k, on: "missing", off: v });
  differences += diffs.length;
  summary.push({ on: args[i], off: args[i + 1], complete: [on.complete, off.complete], totals: { on: on.totals, off: off.totals }, compared: on.observations.length, identical: on.observations.length - diffs.length, differences: diffs });
}
console.log(JSON.stringify({ kind: "stage4-cached-vs-uncached-differential", differences, summary }, null, 2));
