// Usage (from a worktree or frozen toolchain root): node dump-eval-ir.ts '<eval source>' [--fn=name]
// Prints the optimized managed JIT IR (post optimizeModule/prune) of one indirect-eval entry.
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerEvalScript } from "@tint/js-engine/lowering";
import { normalizeManagedSurfaceApplications } from "../../../packages/compiler/src/native/managed-applications.ts";
import { adaptManagedSurfaceEntry } from "../../../packages/compiler/src/native/managed-entry.ts";
import { prepareManagedJitProgram, lowerManagedJitProgram } from "../../../packages/compiler/src/native/managed-jit-program.ts";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
const source = process.argv[2] ?? "x=x+1;", only = process.argv.find((a) => a.startsWith("--fn="))?.slice(5);
const fixture = createManagedScriptFixture();
const parsed = parseScript(createSourceTextView(source));
if (!parsed.ok) throw Error("parse");
const lowered = lowerEvalScript(parsed.value, source);
if (!lowered.ok) throw Error("lower " + JSON.stringify(lowered.error));
const read = fixture.read, frame = read.directory.frame!, surface = read.contracts.surface;
const normalized = normalizeManagedSurfaceApplications(lowered.value, fixture.specifiers, fixture.instantiations, surface);
if (!normalized.ok) throw Error(normalized.error);
const adapted = adaptManagedSurfaceEntry(normalized.value.module, "execute", [...fixture.specifiers], surface, { frame }, "none");
if (!adapted.ok) throw Error(adapted.error);
const aliases = surface.declarations.map((d: { name: string }) => d.name);
const prepared = prepareManagedJitProgram(adapted.value.module, adapted.value.entry, adapted.value.view!, aliases, fixture.runtime, undefined, undefined);
if (!prepared.ok) throw Error(prepared.error);
const ir = lowerManagedJitProgram(prepared.value, fixture.runtime.target);
if (!ir.ok) throw Error(ir.error);
const module = ir.value.module;

if (process.env.P_GUARD_ORIGINS === "1") {
  const scalar: any = await import("../../../packages/ir/src/scalar/index.ts");
  const stable = scalar.stableRecordLayouts(module);
  const tally = new Map<string, number>();
  for (const fn of module.functions as any[]) {
    if (fn.blocks.length === 0) continue;
    const g0 = scalar.provenRecordGuards(fn, 100000, stable), g1 = scalar.dataflowRecordGuards(fn, 2000000, stable);
    const producers = new Map<number, string>();
    for (const b of fn.blocks) for (const op of b.instructions) { const id = scalar.instructionResult(op); if (id !== undefined) producers.set(id, op.kind === "call-indirect" || op.kind === "call" ? "call" : op.kind); }
    const slotWriters = new Map<number, Set<string>>();
    for (const b of fn.blocks) { for (const op of b.instructions) if (op.kind === "store") { const set = slotWriters.get(op.slot) ?? new Set<string>(); set.add(producers.get(op.value) ?? "cross-block"); slotWriters.set(op.slot, set); } const t = b.terminator; if (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") { const set = slotWriters.get(t.slot) ?? new Set<string>(); set.add("field-transfer"); slotWriters.set(t.slot, set); } if (b.exception) { const set = slotWriters.get(b.exception.slot) ?? new Set<string>(); set.add("exception"); slotWriters.set(b.exception.slot, set); } }
    for (const b of fn.blocks) {
      const t = b.terminator;
      if ((t.kind !== "record" && t.kind !== "record-cell") || g0?.[b.id] === 1 || g1?.[b.id] === 1) continue;
      const def = b.instructions.find((op: any) => scalar.instructionResult(op) === t.object);
      let origin = def === undefined ? "cross-block" : def.kind;
      if (def?.kind === "load") origin = "slot<-" + [...(slotWriters.get(def.slot) ?? new Set(["param"]))].sort().join("|") + (fn.parameters.includes(def.slot) ? "|param" : "");
      const key = t.kind + " " + origin;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.error("unproven", v, k);
}
const fmt = (o: unknown) => JSON.stringify(o).replace(/"([a-zA-Z]+)":/g, "$1:").replace(/"/g, "'");
let totalBlocks = 0, totalOps = 0;
const kinds = new Map<string, number>();
module.functions.forEach((fn: any, index: number) => {
  totalBlocks += fn.blocks.length;
  for (const b of fn.blocks) { totalOps += b.instructions.length; kinds.set(b.terminator.kind, (kinds.get(b.terminator.kind) ?? 0) + 1); }
  if (only !== undefined && !String(fn.name).includes(only)) return;
  console.log(`fn#${index} ${fn.name} params=${fmt(fn.parameters)} slots=${fn.slots.length} blocks=${fn.blocks.length}${index === ir.value.entry ? " ENTRY" : ""}`);
  fn.blocks.forEach((b: any, bi: number) => {
    console.log(`  b${bi}:`);
    for (const op of b.instructions) console.log("    " + fmt(op));
    console.log("    => " + fmt(b.terminator));
  });
});
console.error(JSON.stringify({ functions: module.functions.length, blocks: totalBlocks, instructions: totalOps, terminators: Object.fromEntries(kinds) }));
