// Aggregate a V8 .cpuprofile: inclusive and self ms per function name (+file).
import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const filter = process.argv[3] ? new RegExp(process.argv[3]) : undefined;
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++)
  dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
const incl = new Map(), self = new Map();
const label = (n) => n.callFrame.functionName + " " + n.callFrame.url.replace(/.*\/packages\//, "") + ":" + n.callFrame.lineNumber;
const within = process.env.WITHIN;
function under(id) { let cur = id; while (cur !== undefined) { if (nodes.get(cur).callFrame.functionName === within) return true; cur = parent.get(cur); } return false; }
for (const [id, ms] of dt) {
  if (within && !under(id)) continue;
  const n = nodes.get(id);
  self.set(label(n), (self.get(label(n)) ?? 0) + ms);
  const seen = new Set();
  let cur = id;
  while (cur !== undefined) {
    const k = label(nodes.get(cur));
    if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + ms); }
    cur = parent.get(cur);
  }
}
const top = (m, k) => [...m].filter(([n]) => !filter || filter.test(n)).sort((a, b) => b[1] - a[1]).slice(0, k);
console.log("INCLUSIVE"); for (const [n, ms] of top(incl, Number(process.argv[4] ?? 60))) console.log(ms.toFixed(0).padStart(8), n);
console.log("SELF"); for (const [n, ms] of top(self, 30)) console.log(ms.toFixed(0).padStart(8), n);
