// Inclusive counts of frames beneath a named frame in macOS sample call graphs.
import { readFileSync } from "node:fs";
const [anchor, ...files] = process.argv.slice(2);
const counts = new Map(); let total = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("Call graph:"));
  const stack = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^([ +!:|]*)(\d+) (.*)$/.exec(line);
    if (!m) { if (line.trim() === "") break; continue; }
    const depth = m[1].length, count = Number(m[2]);
    const name = m[3].replace(/\s+\(in test\).*$/, "").replace(/ \[[^\]]*\]$/, "");
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    const under = parent ? parent.under : false;
    const seen = parent ? parent.seen : new Set();
    const isAnchor = name.includes(anchor);
    const nowUnder = under || isAnchor;
    const nextSeen = new Set(seen);
    if (nowUnder && !seen.has(name)) { counts.set(name, (counts.get(name) ?? 0) + count); nextSeen.add(name); }
    if (isAnchor && !under) total += count;
    stack.push({ depth, under: nowUnder, seen: nextSeen });
  }
}
console.log("anchor total", total);
for (const [n, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(c).padStart(5), n.slice(0, 150));
