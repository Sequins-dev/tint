// Inclusive sample counts of named compiler phases from macOS `sample` call graphs.
import { readFileSync } from "node:fs";
const phases = ["prepareManagedSurfaceEntry", "prepareManagedJitProgram", "linkModules", "bindModule", "specializeModule", "specializeCheckedRoots", "checkClosureModule", "prepareCollectionRuntimes", "prepareCollectionPass", "lowerManagedJitProgram", "lowerModuleEntries", "verifyManagedJitFrame", "bindManagedJitRecords", "managedRuntimeKeysForOptions", "bindManagedRuntimeImports", "bindManagedJitSignatures", "createTypeSystem", "createManagedTypeContractIndex", "emitModule", "optimizeModule", "linkManagedSurfaceModule", "readManagedSurfaceDirectory", "planManagedSurfaceContracts", "parseModule", "lowerScriptEntry|lowerDirectEvalScript|lowerEvalScript", "copying.ts|nursery.ts|scan.ts"];
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("Call graph:"));
  const counts = new Map(phases.map((p) => [p, 0]));
  const stack = []; // {depth, matched:Set}
  let total = 0;
  for (const line of lines.slice(start + 1)) {
    const m = /^([ +!:|]*)(\d+) (.*)$/.exec(line);
    if (!m) { if (line.trim() === "" ) break; continue; }
    const depth = m[1].length, count = Number(m[2]), frame = m[3];
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const inherited = stack.length ? stack[stack.length - 1].matched : new Set();
    if (!stack.length) total += count;
    const matched = new Set(inherited);
    for (const p of phases) if (!inherited.has(p) && new RegExp(":(" + p + ")\\b|/(" + p + ")").test(frame)) { counts.set(p, counts.get(p) + count); matched.add(p); }
    stack.push({ depth, matched });
  }
  console.log(file.split("/").slice(-2).join("/"), "total", total);
  for (const [p, c] of counts) if (c) console.log("  ", String(c).padStart(5), (100 * c / total).toFixed(1).padStart(5) + "%", p);
}
