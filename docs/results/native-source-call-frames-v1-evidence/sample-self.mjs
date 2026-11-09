// Self and inclusive sample counts per function from macOS `sample` call graphs.
import { readFileSync } from "node:fs";
const files = process.argv.slice(2);
const self = new Map(), incl = new Map(); let total = 0;
const clean = (s) => s.replace(/\s+\(in [^)]*\).*$/, "").replace(/ \[[^\]]*\]$/, "").replace(/^(program|runtime):/, "").trim();
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("Call graph:"));
  const stack = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^([ +!:|]*)(\d+) (.*)$/.exec(line);
    if (!m) { if (line.trim() === "") break; continue; }
    const depth = m[1].length, count = Number(m[2]), name = clean(m[3]);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.childSum += count; else total += count;
    const seen = parent ? parent.seen : new Set();
    if (!seen.has(name)) incl.set(name, (incl.get(name) ?? 0) + count);
    const node = { depth, count, name, childSum: 0, seen: new Set([...seen, name]) };
    stack.push(node);
    node.finish = () => self.set(name, (self.get(name) ?? 0) + Math.max(0, count - node.childSum));
    (globalThis.__all ??= []).push(node);
  }
}
for (const node of globalThis.__all ?? []) node.finish();
const fmt = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => String(v).padStart(6) + " " + (100 * v / total).toFixed(1).padStart(5) + "% " + k.slice(0, 130)).join("\n");
console.log("total", total, "\nSELF\n" + fmt(self, Number(process.env.N ?? 40)) + "\nINCLUSIVE\n" + fmt(incl, Number(process.env.N ?? 40)));
